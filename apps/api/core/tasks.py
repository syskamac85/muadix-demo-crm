from __future__ import annotations

import logging
import csv
import os
import shutil
import tempfile
from io import StringIO
from typing import Any, Dict

from celery import shared_task
from django.core.files.base import ContentFile
from django.utils import timezone

from pathlib import Path
from tempfile import NamedTemporaryFile
import subprocess

from django.conf import settings
from django.core.files.base import File

from .broadcast import broadcast_job_update, broadcast_log_entry
from .models import BackupJob, ImportJob, ImportRecord
from .services.import_excel import ImportCancelled, import_clients_from_excel

logger = logging.getLogger(__name__)


def generate_pg_dump_bytes() -> bytes:
    """Run pg_dump against the default DB and return raw bytes of the dump.

    Raises RuntimeError with a human-readable message on failure.
    """
    if settings.DATABASES['default']['ENGINE'] not in (
        'django.db.backends.postgresql',
        'django.db.backends.postgresql_psycopg2',
    ):
        raise RuntimeError('Backup wspiera tylko bazę PostgreSQL.')

    default_db = settings.DATABASES['default']
    db_user = default_db.get('USER')
    password = default_db.get('PASSWORD') or ''
    host = default_db.get('HOST') or 'localhost'
    port = str(default_db.get('PORT') or '5432')
    name = default_db.get('NAME')
    sslmode = (
        default_db.get('OPTIONS', {}).get('sslmode')
        or default_db.get('SSLMODE')
        or None
    )

    conn_query = f"?sslmode={sslmode}" if sslmode else ""
    conn_url = f"postgresql://{db_user}:{password}@{host}:{port}/{name}{conn_query}"

    env = os.environ.copy()
    if password:
        env['PGPASSWORD'] = password
    if sslmode:
        env['PGSSLMODE'] = sslmode

    tmp_path: Path | None = None
    try:
        with NamedTemporaryFile(delete=False, suffix='.dump') as tmp:
            tmp_path = Path(tmp.name)
        tmp_dir = tmp_path.parent

        def _run_docker() -> tuple[bool, str | None]:
            if shutil.which('docker') is None:
                return False, 'Nie znaleziono polecenia docker.'
            docker_cmd = ['docker', 'run', '--rm', '-e', f'PGPASSWORD={password}']
            if sslmode:
                docker_cmd += ['-e', f'PGSSLMODE={sslmode}']
            if hasattr(os, 'getuid') and hasattr(os, 'getgid'):
                docker_cmd += ['-u', f"{os.getuid()}:{os.getgid()}"]
            docker_cmd += [
                '-v', f"{tmp_dir}:/backups",
                'postgres:17',
                'pg_dump', '--format', 'c', '--no-owner',
                '--dbname', conn_url,
                '--file', f'/backups/{tmp_path.name}',
            ]
            try:
                subprocess.run(docker_cmd, check=True, text=True)
                return True, None
            except subprocess.CalledProcessError as exc:
                return False, f'Błąd pg_dump (docker): {exc}'
            except FileNotFoundError:
                return False, 'Nie znaleziono polecenia docker.'

        fallback_to_docker = False
        try:
            subprocess.run(
                ['pg_dump', '--format', 'c', '--no-owner', '--dbname', conn_url, '--file', str(tmp_path)],
                check=True, env=env, capture_output=True, text=True,
            )
        except FileNotFoundError:
            fallback_to_docker = True
        except subprocess.CalledProcessError as exc:
            if 'server version mismatch' in (exc.stderr or '') or 'server version mismatch' in (exc.stdout or ''):
                fallback_to_docker = True
            else:
                raise RuntimeError(f'Błąd pg_dump: {exc.stderr or exc.stdout or str(exc)}')

        if fallback_to_docker:
            ok, docker_error = _run_docker()
            if not ok:
                raise RuntimeError(docker_error or 'Nie udało się wykonać backupu przez Docker.')

        with open(tmp_path, 'rb') as fh:
            return fh.read()
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


@shared_task(bind=True)
def process_import_job(self, job_id: str) -> None:
    try:
        job = ImportJob.objects.select_related('tenant').get(pk=job_id)
    except ImportJob.DoesNotExist:
        logger.warning("ImportJob %s no longer exists", job_id)
        return

    job.records.all().delete()
    if job.failed_geocode_log:
        job.failed_geocode_log.delete(save=False)
        job.failed_geocode_log = None
    job.status = ImportJob.Status.RUNNING
    job.error_message = ''
    job.total_rows = 0
    job.processed_rows = 0
    job.inserted_count = 0
    job.updated_count = 0
    job.geocoded_count = 0
    job.failed_geocode_count = 0
    job.started_at = timezone.now()
    job.finished_at = None
    job.save(
        update_fields=[
            'status',
            'error_message',
            'total_rows',
            'processed_rows',
            'inserted_count',
            'updated_count',
            'geocoded_count',
            'failed_geocode_count',
            'started_at',
            'finished_at',
            'failed_geocode_log',
        ],
    )
    broadcast_job_update(job)

    def progress_callback(event: Dict[str, Any]) -> None:
        nonlocal job
        if event.get('type') == 'meta':
            job.total_rows = event.get('total_rows', 0) or 0
            job.save(update_fields=['total_rows'])
            broadcast_job_update(job)
        elif event.get('type') == 'row':
            record = ImportRecord.objects.create(
                job=job,
                order=event.get('order', 0),
                name=event.get('name', ''),
                nip=event.get('nip', ''),
                action=event.get('action', 'skipped'),
                geocoded=event.get('geocoded', False),
                message=event.get('message') or '',
                city=event.get('city') or '',
                postal_code=event.get('postal_code') or '',
                street=event.get('street') or '',
            )
            job.processed_rows = event.get('order', job.processed_rows)
            action = event.get('action')
            if action == 'inserted':
                job.inserted_count += 1
            elif action == 'updated':
                job.updated_count += 1
            if event.get('geocoded'):
                job.geocoded_count += 1
            else:
                job.failed_geocode_count += 1
            job.save(
                update_fields=[
                    'processed_rows',
                    'inserted_count',
                    'updated_count',
                    'geocoded_count',
                    'failed_geocode_count',
                ]
            )
            broadcast_job_update(job)
            broadcast_log_entry(record)

    def should_cancel() -> bool:
        job.refresh_from_db(fields=['cancel_requested'])
        return job.cancel_requested

    def update_failed_geocode_log() -> None:
        failed_records = job.records.filter(geocoded=False).values_list(
            'order', 'name', 'nip', 'action', 'message', 'city', 'postal_code', 'street'
        )
        if not failed_records:
            if job.failed_geocode_log:
                job.failed_geocode_log.delete(save=False)
                job.failed_geocode_log = None
            return

        buffer = StringIO()
        writer = csv.writer(buffer)
        writer.writerow(['Lp.', 'Nazwa', 'NIP', 'Akcja', 'Miasto', 'Kod', 'Ulica', 'Komunikat'])
        for order, name, nip, action, message, city, postal_code, street in failed_records:
            writer.writerow([order, name, nip, action, city or '', postal_code or '', street or '', message or ''])
        content = buffer.getvalue().encode('utf-8')
        filename = f'failed_geocode_{job.id}.csv'
        job.failed_geocode_log.save(filename, ContentFile(content), save=False)

    try:
        source = job.upload.path
        if not os.path.exists(source) and job.upload_blob:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp:
                tmp.write(job.upload_blob)
                tmp.flush()
                source = tmp.name
        summary = import_clients_from_excel(
            source,
            job.tenant,
            progress_callback=progress_callback,
            should_cancel=should_cancel,
            use_transaction=False,
        )
        update_failed_geocode_log()
        job.status = ImportJob.Status.SUCCESS
        job.total_rows = summary.total_rows
        job.processed_rows = summary.total_rows
        job.inserted_count = summary.inserted
        job.updated_count = summary.updated
        job.geocoded_count = summary.geocoded
        job.failed_geocode_count = summary.failed_geocode
        job.finished_at = timezone.now()
        job.save(
            update_fields=[
                'status',
                'total_rows',
                'processed_rows',
                'inserted_count',
                'updated_count',
                'geocoded_count',
                'failed_geocode_count',
                'finished_at',
                'failed_geocode_log',
            ]
        )
        broadcast_job_update(job)
    except ImportCancelled:
        update_failed_geocode_log()
        job.status = ImportJob.Status.CANCELLED
        job.error_message = 'Import został zatrzymany przez użytkownika.'
        job.finished_at = timezone.now()
        job.save(update_fields=['status', 'error_message', 'finished_at', 'failed_geocode_log'])
        broadcast_job_update(job)
    except Exception as exc:  # pragma: no cover - defensive logging
        update_failed_geocode_log()
        job.status = ImportJob.Status.ERROR
        job.error_message = str(exc)
        job.finished_at = timezone.now()
        job.save(update_fields=['status', 'error_message', 'finished_at', 'failed_geocode_log'])
        broadcast_job_update(job)
        logger.exception("Import job %s failed: %s", job_id, exc)
        raise


@shared_task(bind=True)
def run_backup_job(self, job_id: int) -> None:
    try:
        job = BackupJob.objects.select_related('tenant', 'created_by').get(pk=job_id)
    except BackupJob.DoesNotExist:
        logger.warning("BackupJob %s no longer exists", job_id)
        return

    job.status = BackupJob.Status.RUNNING
    job.started_at = timezone.now()
    job.error_message = ''
    job.save(update_fields=['status', 'started_at', 'error_message'])

    try:
        generate_pg_dump_bytes()
    except RuntimeError as exc:
        job.status = BackupJob.Status.ERROR
        job.error_message = str(exc)
        job.finished_at = timezone.now()
        job.save(update_fields=['status', 'error_message', 'finished_at'])
        return
    except Exception as exc:  # pragma: no cover
        job.status = BackupJob.Status.ERROR
        job.error_message = str(exc)
        job.finished_at = timezone.now()
        job.save(update_fields=['status', 'error_message', 'finished_at'])
        logger.exception("Backup job %s failed: %s", job_id, exc)
        return

    job.status = BackupJob.Status.SUCCESS
    job.finished_at = timezone.now()
    job.save(update_fields=['status', 'finished_at'])
