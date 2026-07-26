from __future__ import annotations

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import ImportJob, ImportRecord, Task, TaskMessage


def serialize_job(job: ImportJob) -> dict:
    return {
        'id': str(job.id),
        'status': job.status,
        'total_rows': job.total_rows,
        'processed_rows': job.processed_rows,
        'inserted_count': job.inserted_count,
        'updated_count': job.updated_count,
        'geocoded_count': job.geocoded_count,
        'failed_geocode_count': job.failed_geocode_count,
        'progress': job.progress,
        'error_message': job.error_message,
        'created_at': job.created_at.isoformat() if job.created_at else None,
        'started_at': job.started_at.isoformat() if job.started_at else None,
        'finished_at': job.finished_at.isoformat() if job.finished_at else None,
    }


def serialize_record(record: ImportRecord) -> dict:
    return {
        'id': str(record.id),
        'order': record.order,
        'name': record.name,
        'nip': record.nip,
        'action': record.action,
        'geocoded': record.geocoded,
        'message': record.message,
        'created_at': record.created_at.isoformat() if record.created_at else None,
    }


def _send(group: str, event_type: str, payload: dict) -> None:
    channel_layer = get_channel_layer()
    if not channel_layer:
        return
    async_to_sync(channel_layer.group_send)(
        group,
        {
            'type': event_type,
            'payload': payload,
        },
    )


def broadcast_job_update(job: ImportJob) -> None:
    _send(f'import_{job.pk}', 'job.update', serialize_job(job))


def broadcast_log_entry(record: ImportRecord) -> None:
    _send(f'import_{record.job_id}', 'job.log', serialize_record(record))


def serialize_task(task: Task) -> dict:
    return {
        'id': task.id,
        'tenant': task.tenant_id,
        'client': task.client_id,
        'client_name': getattr(task.client, 'name', None),
        'client_city': getattr(task.client, 'city', None),
        'title': task.title,
        'description': task.description,
        'due_date': task.due_date.isoformat() if task.due_date else None,
        'status': task.status,
        'assigned_to': task.assigned_to_id,
        'assigned_to_name': getattr(task.assigned_to, 'username', None),
        'created_by': task.created_by_id,
        'created_by_name': getattr(task.created_by, 'username', None),
        'completed_at': task.completed_at.isoformat() if task.completed_at else None,
        'completed_by': task.completed_by_id,
        'days_until_due': task.days_until_due,
        'updated_at': task.updated_at.isoformat() if task.updated_at else None,
    }


def serialize_task_message(message: TaskMessage) -> dict:
    return {
        'id': message.id,
        'task': message.task_id,
        'author': message.author_id,
        'author_name': getattr(message.author, 'username', None),
        'author_role': getattr(message.author, 'role', None),
        'body': message.body,
        'is_completion': message.is_completion,
        'is_manager_reply': message.is_manager_reply,
        'created_at': message.created_at.isoformat() if message.created_at else None,
    }


def _task_groups(task: Task) -> list[str]:
    groups = [f'tasks_tenant_{task.tenant_id}']
    if task.assigned_to_id:
        groups.append(f'tasks_user_{task.assigned_to_id}')
    if task.created_by_id and task.created_by_id != task.assigned_to_id:
        groups.append(f'tasks_user_{task.created_by_id}')
    return groups


def broadcast_task_update(task: Task) -> None:
    payload = serialize_task(task)
    for group in _task_groups(task):
        _send(group, 'task.update', payload)


def broadcast_task_message(message: TaskMessage) -> None:
    payload = serialize_task_message(message)
    for group in _task_groups(message.task):
        _send(group, 'task.message', payload)
