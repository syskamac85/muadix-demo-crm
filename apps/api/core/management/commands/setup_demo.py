import random
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.models import Tenant, UserRole
from core.models import (
    CallRecord,
    Client,
    ClientDeletionRequest,
    Comment,
    ContactNextDateRequest,
    RoutePlan,
    RouteStop,
    Task,
    Visit,
)

User = get_user_model()

DEMO_USERNAME = 'admin'
DEMO_PASSWORD = 'demo1234'
DEMO_TENANT_SLUG = 'demo'
DEMO_TENANT_NAME = 'Demo Sp. z o.o.'

DEMO_CITIES = [
    ('Warszawa', '00-001', 'ul. Marszałkowska 10', 52.2297, 21.0122),
    ('Kraków', '30-001', 'ul. Floriańska 15', 50.0614, 19.9366),
    ('Wrocław', '50-001', 'ul. Świdnicka 20', 51.1079, 17.0385),
    ('Poznań', '60-001', 'ul. Święty Marcin 25', 52.4064, 16.9252),
    ('Gdańsk', '80-001', 'ul. Długa 30', 54.3520, 18.6466),
    ('Łódź', '90-001', 'ul. Piotrkowska 100', 51.7592, 19.4560),
    ('Szczecin', '70-001', 'ul. Hoża 5', 53.4285, 14.5528),
    ('Lublin', '20-001', 'ul. Krakowskie Przedmieście 50', 51.2465, 22.5684),
    ('Katowice', '40-001', 'ul. 3 Maja 12', 50.2649, 19.0238),
    ('Bydgoszcz', '85-001', 'ul. Gdańska 40', 53.1235, 18.0084),
]

DEMO_CLIENT_NAMES = [
    'TechNova Sp. z o.o.', 'GreenFood Plus', 'BudStal S.A.', 'MediCare Solutions',
    'EkoEnergia Sp. z o.o.', 'AutoSerwis Kowalski', 'DrukPol S.A.', 'LogisticPro Sp. z o.o.',
    'AgroHurt Plus', 'StolBud S.A.', 'ChemiaTech Sp. z o.o.', 'MetalWrocław S.A.',
    'OptiKer Sp. z o.o.', 'BHPProfi Sp. z o.o.', 'ITCloud Solutions S.A.',
    'FarmaZdravo Sp. z o.o.', 'TransExpress S.A.', 'WodKan Sp. z o.o.',
    'ElektroMar S.A.', 'PakPol Sp. z o.o.', 'KlimaTech S.A.', 'BakerHouse Sp. z o.o.',
    'SportMax S.A.', 'EduPlus Sp. z o.o.', 'FinConsult Sp. z o.o.',
    'TurystykaWielka S.A.', 'CementOwnia Sp. z o.o.', 'MebleArt S.A.',
    'ZielonyOgród Sp. z o.o.', 'AluTech S.A.',
]

DEMO_REPS = [
    ('mnowak', 'Marek Nowak'),
    ('awisniewski', 'Adam Wiśniewski'),
    ('kwiecinski', 'Kamil Kwieciński'),
]

DEMO_MANAGERS = [
    ('jkowalski', 'Jan Kowalski'),
]

DEMO_TASK_TITLES = [
    'Przygotowanie oferty handlowej',
    'Wizyta u klienta - prezentacja produktu',
    'Negocjacje warunków współpracy',
    'Odbiór zamówienia',
    'Rozwiązanie problemu technicznego',
    'Ustalenie harmonogramu dostaw',
    'Aktualizacja danych klienta',
    'Follow-up po ostatniej wizycie',
]

DEMO_OUTCOMES = [
    'Zainteresowany, wyśle ofertę',
    'Prosi o callback za tydzień',
    'Negocjuje rabat',
    'Zamówienie w przygotowaniu',
    'Brak zainteresowania',
    'Umowa podpisana',
    'Prosi o spotkanie',
    'Odracza decyzję do końca miesiąca',
]


def _random_nip():
    return ''.join(str(random.randint(0, 9)) for _ in range(10))


class Command(BaseCommand):
    help = 'Tworzy konto admina demo, tenanta demo i generuje fikcyjne dane.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Resetuj hasło admina demo do wartości domyślnej.',
        )
        parser.add_argument(
            '--no-data',
            action='store_true',
            help='Nie generuj fikcyjnych danych (tylko admin + tenant).',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        tenant, created = Tenant.objects.get_or_create(
            slug=DEMO_TENANT_SLUG,
            defaults={'name': DEMO_TENANT_NAME},
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f'Utworzono tenanta: {tenant.name}'))
        else:
            self.stdout.write(f'Tenant istnieje: {tenant.name}')

        user = User.objects.filter(username=DEMO_USERNAME).first()
        if user is None:
            user = User.objects.create_superuser(
                username=DEMO_USERNAME,
                email='admin@demo.local',
                password=DEMO_PASSWORD,
                role=UserRole.ADMIN,
                tenant=tenant,
            )
            self.stdout.write(self.style.SUCCESS(
                f'Utworzono admina demo: {DEMO_USERNAME} / {DEMO_PASSWORD}'
            ))
        else:
            if user.role != UserRole.ADMIN:
                user.role = UserRole.ADMIN
                user.is_staff = True
                user.is_superuser = True
                user.tenant = tenant
                user.save(update_fields=['role', 'is_staff', 'is_superuser', 'tenant'])
                self.stdout.write(self.style.WARNING(
                    f'Użytkownik {DEMO_USERNAME} awansowany do roli admin.'
                ))
            if options.get('reset'):
                user.set_password(DEMO_PASSWORD)
                user.save(update_fields=['password'])
                self.stdout.write(self.style.SUCCESS(
                    f'Hasło admina demo zresetowane do: {DEMO_PASSWORD}'
                ))
            else:
                self.stdout.write(f'Admin demo istnieje: {DEMO_USERNAME}')

        if options.get('no_data'):
            self.stdout.write(self.style.SUCCESS('Setup demo zakończony (bez danych).'))
            return

        self._purge_old_data()
        reps = self._create_demo_users(tenant)
        self._generate_demo_data(tenant, admin=user, reps=reps)

        self.stdout.write(self.style.SUCCESS('Setup demo zakończony.'))

    def _purge_old_data(self):
        self.stdout.write('Czyszczenie starej bazy...')
        ContactNextDateRequest.objects.all().delete()
        ClientDeletionRequest.objects.all().delete()
        Comment.objects.all().delete()
        CallRecord.objects.all().delete()
        RouteStop.objects.all().delete()
        RoutePlan.objects.all().delete()
        Visit.objects.all().delete()
        Task.objects.all().delete()
        Client.objects.all().delete()
        User.objects.exclude(username=DEMO_USERNAME).exclude(is_superuser=True).exclude(is_staff=True).filter(tenant__isnull=False).delete()
        Tenant.objects.exclude(slug=DEMO_TENANT_SLUG).delete()
        self.stdout.write(self.style.SUCCESS('Stara baza wyczyszczona.'))

    def _create_demo_users(self, tenant):
        self.stdout.write('Tworzenie użytkowników demo...')

        for username, full_name in DEMO_MANAGERS:
            mgr, created = User.objects.get_or_create(
                username=username,
                defaults={
                    'email': f'{username}@demo.local',
                    'role': UserRole.MANAGER,
                    'tenant': tenant,
                    'first_name': full_name.split()[0],
                    'last_name': full_name.split()[1],
                },
            )
            if created:
                mgr.set_password('demo1234')
                mgr.save()
                self.stdout.write(f'  Utworzono managera: {username}')

        reps = []
        for username, full_name in DEMO_REPS:
            rep, created = User.objects.get_or_create(
                username=username,
                defaults={
                    'email': f'{username}@demo.local',
                    'role': UserRole.REP,
                    'tenant': tenant,
                    'first_name': full_name.split()[0],
                    'last_name': full_name.split()[1],
                },
            )
            if created:
                rep.set_password('demo1234')
                rep.save()
                self.stdout.write(f'  Utworzono handlowca: {username}')
            reps.append(rep)

        return reps

    def _generate_demo_data(self, tenant, admin, reps):
        self.stdout.write('Generowanie fikcyjnych danych...')

        managers = list(User.objects.filter(role=UserRole.MANAGER, tenant=tenant))
        all_salesmen = reps + managers

        if not reps:
            reps = [admin]
        if not managers:
            managers = [admin]

        clients = []
        today = timezone.localdate()

        for i, name in enumerate(DEMO_CLIENT_NAMES):
            city_data = DEMO_CITIES[i % len(DEMO_CITIES)]
            city, postal, street, lat, lng = city_data
            salesman = random.choice(all_salesmen) if all_salesmen else admin

            client = Client.objects.create(
                tenant=tenant,
                name=name,
                nip=_random_nip(),
                city=city,
                postal_code=postal,
                street=f'{street}/{i + 1}',
                classification=random.choice(['A', 'B', 'C', 'VIP']),
                salesman=salesman,
                latitude=lat + random.uniform(-0.02, 0.02),
                longitude=lng + random.uniform(-0.02, 0.02),
                location_name=f'{city}, {street}',
                last_invoice_date=today - timedelta(days=random.randint(1, 120)),
                type=random.choice(['Sklep', 'Hurtownia', 'Producent', 'Usługi', 'Serwis']),
                phone=f'+48 {random.randint(10, 99)} {random.randint(100, 999)} {random.randint(10, 99)} {random.randint(10, 99)}',
                email=f'biuro@{name.lower().replace(" ", "").replace(".", "").replace(",", "")}.pl',
                contact_reminder_days=random.choice([7, 14, 21, 30, 45]),
                status=Client.Status.ACTIVE,
            )
            clients.append(client)

        self.stdout.write(f'  Utworzono {len(clients)} klientów.')

        for client in clients:
            num_calls = random.randint(1, 4)
            for _ in range(num_calls):
                days_ago = random.randint(1, 90)
                contact_date = today - timedelta(days=days_ago)
                handler = client.salesman or admin
                CallRecord.objects.create(
                    tenant=tenant,
                    client=client,
                    handler=handler,
                    contact_date=contact_date,
                    contact_time=timezone.now().time(),
                    next_contact_at=contact_date + timedelta(days=random.choice([7, 14, 21, 30])),
                    outcome=random.choice(DEMO_OUTCOMES),
                    current_comment=f'Kontakt z klientem {client.name}. {random.choice(DEMO_OUTCOMES)}.',
                    previous_comment='',
                )

        self.stdout.write('  Utworzono rekordy kontaktów.')

        for client in clients[:15]:
            for _ in range(random.randint(1, 3)):
                Comment.objects.create(
                    tenant=tenant,
                    author=client.salesman or admin,
                    client=client,
                    body=f'Komentarz do klienta {client.name}. {random.choice(DEMO_OUTCOMES)}.',
                    comment_type=random.choice([Comment.PRE_VISIT, Comment.POST_VISIT]),
                )

        self.stdout.write('  Utworzono komentarze.')

        for client in clients[:10]:
            Task.objects.create(
                tenant=tenant,
                client=client,
                created_by=admin,
                assigned_to=client.salesman or random.choice(reps),
                title=random.choice(DEMO_TASK_TITLES),
                description=f'Zadanie dla klienta {client.name}. Priorytet: {random.choice(["wysoki", "średni", "niski"])}.',
                due_date=today + timedelta(days=random.randint(1, 30)),
                status=random.choice([Task.Status.PENDING, Task.Status.IN_PROGRESS, Task.Status.AWAITING_REVIEW]),
            )

        self.stdout.write('  Utworzono zadania.')

        for rep in reps:
            route = RoutePlan.objects.create(
                tenant=tenant,
                owner=rep,
                date=today,
                total_drive_minutes=random.randint(30, 120),
                total_visit_minutes=random.randint(60, 240),
                shared_with_manager=True,
                approval_status=random.choice([RoutePlan.ApprovalStatus.PENDING, RoutePlan.ApprovalStatus.APPROVED]),
            )
            route_clients = random.sample(clients, min(5, len(clients)))
            for order, client in enumerate(route_clients, 1):
                RouteStop.objects.create(
                    route=route,
                    client=client,
                    order=order,
                    drive_minutes=random.randint(5, 30),
                    visit_minutes=random.randint(15, 45),
                    phone=client.phone,
                    email=client.email,
                    comment='',
                )

        self.stdout.write('  Utworzono trasy handlowców.')

        for client in clients[:5]:
            Visit.objects.create(
                tenant=tenant,
                client=client,
                salesman=client.salesman or admin,
                planned_at=timezone.now() - timedelta(days=random.randint(1, 30)),
                duration_minutes=random.randint(15, 60),
                status=random.choice(['planned', 'completed', 'cancelled']),
                comment=f'Wizyta u klienta {client.name}.',
                latitude=client.latitude,
                longitude=client.longitude,
                location_name=client.location_name,
            )

        self.stdout.write('  Utworzono wizyty.')

        for client in clients[:3]:
            ClientDeletionRequest.objects.create(
                tenant=tenant,
                client=client,
                requested_by=random.choice(reps),
                reason=f'Klient {client.name} nie odpowiada na kontakty od 3 miesięcy.',
            )

        self.stdout.write('  Utworzono wnioski o usunięcie.')

        self.stdout.write(self.style.SUCCESS(
            f'Dane demo wygenerowane: {len(clients)} klientów, kontakty, zadania, trasy, wizyty.'
        ))
