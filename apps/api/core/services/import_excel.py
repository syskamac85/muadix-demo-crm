from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass
from io import BytesIO, BufferedReader
from pathlib import Path
from typing import Callable, IO, Optional, Union

import os
import pandas as pd
from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from geopy.exc import GeocoderUnavailable
from geopy.extra.rate_limiter import RateLimiter
from geopy.geocoders import MapBox, Nominatim

from accounts.models import Tenant, User, UserRole
from core.models import Client

MAPBOX_ACCESS_TOKEN = os.getenv('MAPBOX_ACCESS_TOKEN')

if MAPBOX_ACCESS_TOKEN:
    _geolocator = MapBox(api_key=MAPBOX_ACCESS_TOKEN, timeout=10)
else:
    _geolocator = Nominatim(user_agent="sun_crm_django_app")

geocode_fn = RateLimiter(
    _geolocator.geocode,
    min_delay_seconds=1,
    max_retries=2,
    error_wait_seconds=2,
    swallow_exceptions=True,
)


@dataclass
class ImportEntry:
    name: str
    nip: str
    action: str
    geocoded: bool
    city: Optional[str] = ''
    postal_code: Optional[str] = ''
    street: Optional[str] = ''
    message: Optional[str] = None


@dataclass
class ImportSummary:
    inserted: int = 0
    updated: int = 0
    geocoded: int = 0
    failed_geocode: int = 0
    total_rows: int = 0
    records: list[ImportEntry] = None

    def __post_init__(self):
        if self.records is None:
            self.records = []


def normalize(value: object) -> Optional[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip()
    return text or None


def geocode_address(city: Optional[str], postal_code: Optional[str], street: Optional[str], number: Optional[str]):
    parts = [street, number, postal_code, city, "Polska"]
    query = ", ".join([p for p in parts if p])
    if not query:
        return None, None
    try:
        location = geocode_fn(query, timeout=10)
        if location:
            return location.latitude, location.longitude
    except GeocoderUnavailable:
        return None, None
    except Exception:
        return None, None
    return None, None


SourceType = Union[UploadedFile, IO[bytes], BufferedReader, bytes, str, Path]


def _load_dataframe(source: SourceType):
    if isinstance(source, UploadedFile):
        buffer = BytesIO(source.read())
    elif isinstance(source, (BytesIO, BufferedReader)):
        source.seek(0)
        buffer = source
    elif isinstance(source, (str, Path)):
        buffer = source
    else:
        buffer = BytesIO(source)
    return pd.read_excel(buffer)


class ImportCancelled(Exception):
    """Raised when an import is cancelled."""


def import_clients_from_excel(
    source: SourceType,
    tenant: Tenant,
    progress_callback: Optional[Callable[[dict], None]] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
    use_transaction: bool = True,
) -> ImportSummary:
    df = _load_dataframe(source)
    summary = ImportSummary(total_rows=len(df))

    if progress_callback:
        progress_callback({'type': 'meta', 'total_rows': summary.total_rows})
    df = df.rename(
        columns={
            "Nazwa kontrahenta": "name",
            "NIP": "nip",
            "Miasto": "city",
            "Kod": "postal_code",
            "Ulica, nr lokalu": "street_with_number",
            "Nazwa klasyfikacji": "classification",
            "Handlowiec": "salesman",
            "Typ klienta": "type",
            "Dni_kontakt": "contact_days",
            "Telefon": "phone",
            "E-mail": "email",
        },
    )

    sales_reps: dict[str, User] = {}
    for user in User.objects.filter(tenant=tenant, role=UserRole.REP, is_active=True):
        def add_key(value: Optional[str]):
            if value:
                key = value.strip().lower()
                if key:
                    sales_reps.setdefault(key, user)

        add_key(user.username)
        add_key(user.email)
        # Support "Imię Nazwisko" or "Nazwisko Imię" as provided in spreadsheets.
        full_name = " ".join(filter(None, [user.first_name, user.last_name]))
        add_key(full_name)
        reversed_name = " ".join(filter(None, [user.last_name, user.first_name]))
        if reversed_name != full_name:
            add_key(reversed_name)

    context = transaction.atomic if use_transaction else nullcontext
    with context():
        for index, row in df.iterrows():
            if should_cancel and should_cancel():
                raise ImportCancelled()
            nip = normalize(row.get("nip"))
            name = normalize(row.get("name"))
            if not nip or not name:
                continue

            def clean_street_value(value):
                if not value:
                    return ""
                value = value.strip()
                if value.lower().startswith("ul."):
                    value = value[3:].lstrip()
                return value

            street_source = normalize(row.get("street_with_number"))
            street_clean = clean_street_value(street_source)

            salesman_name = normalize(row.get("salesman"))
            salesman = None
            if salesman_name:
                salesman = sales_reps.get(salesman_name.lower())

            payload = {
                "name": name,
                "city": normalize(row.get("city")),
                "postal_code": normalize(row.get("postal_code")),
                "street": street_clean,
                "classification": normalize(row.get("classification")) or "",
                "type": normalize(row.get("type")) or "",
                "phone": normalize(row.get("phone")) or "",
                "email": normalize(row.get("email")) or "",
            }

            contact_days_raw = normalize(row.get("contact_days"))

            def append_contact_error(message: str):
                entry = ImportEntry(
                    name=name,
                    nip=nip,
                    action='skipped',
                    geocoded=False,
                    city=payload["city"] or "",
                    postal_code=payload["postal_code"] or "",
                    street=payload["street"] or "",
                    message=message,
                )
                summary.records.append(entry)
                if progress_callback:
                    progress_callback(
                        {
                            'type': 'row',
                            'order': index + 1,
                            'name': name,
                            'nip': nip,
                            'action': entry.action,
                            'geocoded': entry.geocoded,
                            'message': entry.message,
                            'city': entry.city,
                            'postal_code': entry.postal_code,
                            'street': entry.street,
                        }
                    )

            if contact_days_raw is None:
                append_contact_error("Brak wartości w kolumnie Dni_kontakt.")
                continue

            payload["contact_days_label"] = contact_days_raw

            try:
                contact_days = int(float(contact_days_raw))
            except (TypeError, ValueError):
                append_contact_error("Niepoprawna liczba w kolumnie Dni_kontakt.")
                continue

            payload["contact_reminder_days"] = max(contact_days, 0)

            city_key = payload["city"] or ""

            client = Client.objects.filter(tenant=tenant, nip=nip, city=city_key).first()
            lat = client.latitude if client else None
            lon = client.longitude if client else None

            if lat is None or lon is None:
                lat, lon = geocode_address(payload["city"], payload["postal_code"], payload["street"], None)
                if lat is not None and lon is not None:
                    summary.geocoded += 1
                else:
                    summary.failed_geocode += 1

            street_combined = payload["street"] or ""

            entry = ImportEntry(
                name=name,
                nip=nip,
                action='skipped',
                geocoded=False,
                city=city_key,
                postal_code=payload["postal_code"] or "",
                street=street_combined,
            )
            order = index + 1

            def build_update_data(existing_client):
                data = {
                    "name": name,
                    "city": payload["city"],
                    "postal_code": payload["postal_code"],
                    "street": street_combined,
                    "classification": payload["classification"],
                    "type": payload["type"],
                    "phone": payload["phone"],
                    "email": payload["email"],
                    "contact_reminder_days": payload["contact_reminder_days"],
                    "contact_days_label": payload.get("contact_days_label", ""),
                    "latitude": lat if lat is not None else (existing_client.latitude if existing_client else None),
                    "longitude": lon if lon is not None else (existing_client.longitude if existing_client else None),
                }
                if salesman is not None:
                    data["salesman"] = salesman
                return data

            lookup_kwargs = {
                "tenant": tenant,
                "nip": nip,
                "city": city_key,
            }

            if client:
                update_data = build_update_data(client)
                Client.objects.filter(pk=client.pk).update(**update_data)
                summary.updated += 1
                entry.action = 'updated'
                entry.geocoded = bool(update_data["latitude"] and update_data["longitude"])
                entry.message = 'Zaktualizowano istniejący rekord.'
            else:
                create_defaults = {
                    "name": name,
                    "postal_code": payload["postal_code"],
                    "street": street_combined,
                    "classification": payload["classification"],
                    "type": payload["type"],
                    "salesman": salesman,
                    "phone": payload["phone"],
                    "email": payload["email"],
                    "contact_reminder_days": payload["contact_reminder_days"],
                    "contact_days_label": payload.get("contact_days_label", ""),
                    "latitude": lat,
                    "longitude": lon,
                }
                client, created = Client.objects.get_or_create(
                    **lookup_kwargs,
                    defaults=create_defaults,
                )
                if created:
                    summary.inserted += 1
                    entry.action = 'inserted'
                    entry.geocoded = bool(lat and lon)
                    entry.message = 'Dodano nowego klienta.'
                else:
                    update_data = build_update_data(client)
                    Client.objects.filter(pk=client.pk).update(**update_data)
                    summary.updated += 1
                    entry.action = 'updated'
                    entry.geocoded = bool(update_data["latitude"] and update_data["longitude"])
                    entry.message = 'Zaktualizowano istniejący rekord (wykryto duplikat).'

            if salesman_name:
                if salesman:
                    entry.message = (entry.message or '') + f' (Handlowiec: {salesman.username})'
                else:
                    entry.message = (entry.message or '') + f" (Nie znaleziono handlowca '{salesman_name}')"

            if lat is None or lon is None:
                entry.message = (entry.message or '') + ' (Brak dokładnych współrzędnych)'

            summary.records.append(entry)
            if progress_callback:
                progress_callback(
                    {
                        'type': 'row',
                        'order': order,
                        'name': name,
                        'nip': nip,
                        'action': entry.action,
                        'geocoded': entry.geocoded,
                        'message': entry.message,
                        'city': entry.city,
                        'postal_code': entry.postal_code,
                        'street': entry.street,
                    }
                )

    return summary
