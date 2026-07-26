#!/usr/bin/env python3
"""
Analiza sugerowanego terminu kontaktu przez aplikację (cykl kontaktowy).
"""
import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'api.settings')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'apps', 'api'))
django.setup()

from datetime import date, timedelta
from core.models import CallRecord, Client, ContactNextDateRequest


def analyze_contact_cycle(client_name: str, contact_date: str):
    print(f"\n{'='*70}")
    print(f"ANALIZA CYKLU KONTAKTOWEGO")
    print(f"{'='*70}\n")
    
    # Znajdź klienta
    client = Client.objects.filter(name__icontains='ZBOJNA').first()
    if not client:
        print(f"❌ Nie znaleziono klienta")
        return
    
    print(f"📋 KLIENT:")
    print(f"   Nazwa: {client.name}")
    print(f"   Cykl kontaktowy (contact_reminder_days): {client.contact_reminder_days} dni")
    print(f"   Etykieta cyklu: {client.contact_days_label or '(brak)'}")
    print()
    
    # Znajdź kontakt
    record = CallRecord.objects.filter(
        client=client,
        contact_date=contact_date
    ).select_related('handler').first()
    
    if not record:
        print(f"❌ Brak kontaktu z {contact_date}")
        return
    
    print(f"📞 KONTAKT Z {contact_date}:")
    print(f"   Handlowiec: {record.handler}")
    print(f"   Godzina: {record.contact_time}")
    print()
    
    # Sprawdź czy był wniosek o zmianę terminu
    requests = ContactNextDateRequest.objects.filter(
        call_record=record
    ).select_related('requested_by', 'reviewed_by')
    
    # Oblicz sugerowany termin (na podstawie cyklu)
    contact_date_obj = record.contact_date
    cycle_days = client.contact_reminder_days or 0
    suggested_date = contact_date_obj + timedelta(days=cycle_days) if cycle_days > 0 else None
    
    print(f"📅 ANALIZA TERMINÓW:")
    print(f"   Data kontaktu: {contact_date_obj}")
    print(f"   Cykl klienta: {cycle_days} dni")
    if suggested_date:
        print(f"   ➤ SUGEROWANY TERMIN PRZEZ APLIKACJĘ: {suggested_date}")
        print(f"     (czyli: {cycle_days} dni po dacie kontaktu)")
    else:
        print(f"   ➤ Brak cyklu — aplikacja nie sugeruje terminu")
    print()
    
    # Faktyczny termin
    actual_next = record.next_contact_at
    print(f"   ✓ FAKTYCZNIE USTAWIONY TERMIN: {actual_next or '(nie zaplanowano)'}")
    
    if actual_next and suggested_date:
        diff = (actual_next - suggested_date).days
        if diff == 0:
            print(f"     ✅ Zgodny z sugestią aplikacji")
        elif diff > 0:
            print(f"     ⏰ Opóźniony o {diff} dni względem sugestii")
        else:
            print(f"     ⏰ Przyspieszony o {abs(diff)} dni względem sugestii")
        
        # Sprawdź czy przekracza 2x cykl
        if cycle_days > 0:
            max_acceptable = contact_date_obj + timedelta(days=cycle_days * 2)
            if actual_next > max_acceptable:
                print(f"     ⚠️  TERMIN PRZEKRACZA 2x CYKL ({max_acceptable})")
                print(f"        Wymaga akceptacji managera!")
    
    print()
    
    # Sprawdź wnioski
    if requests.exists():
        print(f"📋 WNIOSKI O ZMIANĘ TERMINU:")
        for req in requests:
            print(f"   ID wniosku: {req.id}")
            print(f"   Status: {req.get_status_display()}")
            print(f"   Cykl klienta: {req.cycle_days} dni")
            print(f"   Proponowane dni: {req.proposed_days} dni")
            print(f"   Zgłoszony przez: {req.requested_by}")
            if req.reviewed_by:
                print(f"   Rozpatrzony przez: {req.reviewed_by} ({req.reviewed_at})")
            print(f"   Powód: {req.reason or '(brak)'}")
            print()
    else:
        print(f"📋 Brak wniosków o zmianę terminu (termin w granicach normy lub ustawiony ręcznie)")
    
    print(f"{'='*70}")


if __name__ == '__main__':
    analyze_contact_cycle("CBF ZBOJNA", "2026-06-10")
