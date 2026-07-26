#!/usr/bin/env python3
"""
Skrypt do analizy kontaktu z konkretnym klientem w danym dniu.
Użycie: python analyze_contact.py "NAZWA_KLIENTA" YYYY-MM-DD
"""
import os
import sys
import django

# Konfiguracja Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'api.settings')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'apps', 'api'))
django.setup()

from datetime import date
from core.models import CallRecord, Client
from django.db.models import Q


def analyze_contact(client_name: str, contact_date: str):
    """Analizuje kontakt z klientem w danym dniu."""
    
    print(f"\n{'='*60}")
    print(f"ANALIZA KONTAKTU")
    print(f"{'='*60}")
    print(f"Klient: {client_name}")
    print(f"Data kontaktu: {contact_date}")
    print(f"{'='*60}\n")
    
    # Znajdź klienta
    clients = Client.objects.filter(
        Q(name__icontains=client_name) | 
        Q(name__icontains=client_name.replace(' ', ''))
    )
    
    if not clients.exists():
        print(f"❌ Nie znaleziono klienta: '{client_name}'")
        # Pokaż podobnych
        similar = Client.objects.filter(name__icontains='ZBOJNA')[:5]
        if similar:
            print("\nPodobni klienci:")
            for c in similar:
                print(f"  - {c.name} (NIP: {c.nip})")
        return
    
    client = clients.first()
    print(f"✅ Znaleziono klienta:")
    print(f"   ID: {client.id}")
    print(f"   Nazwa: {client.name}")
    print(f"   NIP: {client.nip}")
    print(f"   Miasto: {client.city}")
    print(f"   Handlowiec przypisany: {client.salesman}")
    print(f"   Status: {client.status}")
    print()
    
    # Znajdź kontakty
    records = CallRecord.objects.filter(
        client=client,
        contact_date=contact_date
    ).select_related('handler', 'client').order_by('-contact_time')
    
    if not records.exists():
        print(f"❌ Brak kontaktów z {contact_date}")
        
        # Pokaż ostatnie kontakty z tego klienta
        recent = CallRecord.objects.filter(
            client=client
        ).select_related('handler').order_by('-contact_date')[:5]
        
        if recent:
            print(f"\nOstatnie kontakty z tego klienta:")
            for r in recent:
                print(f"  {r.contact_date} | {r.handler} | {r.outcome or '(brak wyniku)'}")
        return
    
    print(f"✅ Znaleziono {records.count()} kontaktów w dniu {contact_date}:\n")
    
    for idx, record in enumerate(records, 1):
        print(f"--- Kontakt #{idx} ---")
        print(f"  Data: {record.contact_date}")
        print(f"  Godzina: {record.contact_time}")
        print(f"  Handlowiec: {record.handler} (ID: {record.handler_id})")
        print(f"  Tenant: {record.tenant}")
        print()
        print(f"  📞 WYNIK KONTAKTU:")
        print(f"     {record.outcome or '(nie podano)'}")
        print()
        print(f"  📝 AKTUALNY KOMENTARZ:")
        print(f"     {record.current_comment or '(brak)'}")
        print()
        
        if record.previous_comment:
            print(f"  📝 POPRZEDNI KOMENTARZ:")
            print(f"     {record.previous_comment}")
            print()
        
        print(f"  📅 NASTĘPNY KONTAKT:")
        if record.next_contact_at:
            print(f"     {record.next_contact_at}")
            # Sprawdź czy wniosek o zmianę cyklu
            from core.models import ContactNextDateRequest
            requests = ContactNextDateRequest.objects.filter(
                call_record=record,
                status='pending'
            )
            if requests.exists():
                print(f"     ⚠️  OCZEKUJE NA AKCEPTACJĘ (wniosek o zmianę cyklu)")
        else:
            print(f"     (nie zaplanowano)")
        print()
        print(f"  🕐 Utworzono: {record.created_at}")
        print(f"  🔄 Zaktualizowano: {record.updated_at}")
        print()
    
    # Statystyki
    print(f"{'='*60}")
    print(f"STATYSTYKI KLIENTA")
    print(f"{'='*60}")
    
    total_contacts = CallRecord.objects.filter(client=client).count()
    last_contact = CallRecord.objects.filter(client=client).order_by('-contact_date').first()
    
    print(f"  Łączna liczba kontaktów: {total_contacts}")
    if last_contact:
        print(f"  Ostatni kontakt: {last_contact.contact_date}")
    print()


if __name__ == '__main__':
    client_name = "CBF ZBOJNA SPÓŁKA KOMANDYTOWA"
    contact_date = "2026-06-10"
    
    if len(sys.argv) > 1:
        client_name = sys.argv[1]
    if len(sys.argv) > 2:
        contact_date = sys.argv[2]
    
    analyze_contact(client_name, contact_date)
