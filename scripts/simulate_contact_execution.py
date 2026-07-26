#!/usr/bin/env python3
"""
Symulacja wykonania kontaktu z nową logiką (zawsze od dnia wykonania).
"""
import os
import sys
import django
from datetime import datetime, timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'api.settings')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'apps', 'api'))
django.setup()

from core.models import Client, CallRecord


def simulate_contact_execution():
    print("=" * 70)
    print("SYMULACJA WYKONANIA KONTAKTU - NOWA LOGIKA")
    print("=" * 70)
    
    # Dane z bazy
    client = Client.objects.filter(name__icontains='ZBOJNA').first()
    if not client:
        print("Klient nie znaleziony")
        return
    
    # Parametry
    execution_date = "2026-06-10"  # Dzień wykonania kontaktu
    due_date = "2026-07-03"      # Zaplanowany termin w cyklu
    cycle_days = 30                # Cykl klienta
    
    print(f"\n📋 DANE KLIENTA:")
    print(f"   Nazwa: {client.name}")
    print(f"   Cykl kontaktowy: {cycle_days} dni")
    print(f"   Zaplanowany termin (due_date): {due_date}")
    
    print(f"\n📅 DATA WYKONANIA KONTAKTU: {execution_date}")
    
    # NOWA LOGIKA (zawsze od dnia wykonania)
    base_date = datetime.strptime(execution_date, "%Y-%m-%d")
    suggested_next = base_date + timedelta(days=cycle_days)
    suggested_next_str = suggested_next.strftime("%Y-%m-%d")
    
    print(f"\n🔄 NOWA LOGIKA SUGEROWANIA:")
    print(f"   Baza obliczenia: {execution_date} (dzień wykonania)")
    print(f"   + {cycle_days} dni cyklu")
    print(f"   = {suggested_next_str}")
    
    # Sprawdzenie granic
    max_acceptable = base_date + timedelta(days=cycle_days * 2)
    print(f"\n📊 WALIDACJA:")
    print(f"   Sugerowana data: {suggested_next_str}")
    print(f"   Maksymalna bez akceptacji (2× cykl): {max_acceptable.strftime('%Y-%m-%d')}")
    
    if suggested_next <= max_acceptable:
        print(f"   ✅ Nie wymaga akceptacji managera")
    else:
        print(f"   ⚠️  WYMAGANA AKCEPTACJA managera!")
    
    # Porównanie ze starą logiką
    old_base = datetime.strptime(due_date, "%Y-%m-%d")
    old_suggested = old_base + timedelta(days=cycle_days)
    
    print(f"\n📊 PORÓWNANIE:")
    print(f"   STARA logika (od due_date {due_date}): {old_suggested.strftime('%Y-%m-%d')}")
    print(f"   NOWA logika (od wykonania {execution_date}): {suggested_next_str}")
    print(f"   Różnica: {(suggested_next - old_suggested).days} dni wcześniej")
    
    # Scenariusz na UI
    print(f"\n" + "=" * 70)
    print(f"JAK TO WYGLĄDA NA INTERFEJSIE (10.06.2026)")
    print(f"=" * 70)
    print(f"""
┌─────────────────────────────────────────────────────────────────────┐
│  CBF ZBOJNA SPÓŁKA KOMANDYTOWA                                       │
│  5252608471 • Warszawa                                              │
│  Cykl: 30 dni  Handlowiec: Łukasz Bodalski                          │
│                                                                     │
│  Kolejny kontakt: {due_date}                                  │
│  Poprzedni termin: 2026-06-03                                       │
├─────────────────────────────────────────────────────────────────────┤
│  OZNACZ WYKONANIE                                                   │
│                                                                     │
│  📅 DATA KONTAKTU                                                   │
│     10.06.2026                                                      │
│     Ustalona automatycznie na dzisiaj.                              │
│                                                                     │
│  📅 NASTĘPNY TERMIN (sugerowany)                                    │
│     [{suggested_next_str}]  ← NOWA DATA!                         │
│                                                                     │
│     (10.06 + 30 dni = 10.07.2026)                                   │
│                                                                     │
│  📝 NOTATKA                                                         │
│     [____________________________________]                          │
│                                                                     │
│  [✓ Zapisz kontakt]                                                 │
│                                                                     │
│  Status: ✅ Nie wymaga akceptacji (w granicach 2× cyklu)             │
└─────────────────────────────────────────────────────────────────────┘
    """)
    
    print(f"\n✅ REZULTAT:")
    print(f"   Handlowiec wykonuje kontakt 10.06.2026")
    print(f"   System sugeruje następny kontakt na: {suggested_next_str}")
    print(f"   (zamiast 02.08.2026 jak było wcześniej)")
    
    print(f"\n" + "=" * 70)


if __name__ == '__main__':
    simulate_contact_execution()
