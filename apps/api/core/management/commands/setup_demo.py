from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from accounts.models import Tenant, UserRole

User = get_user_model()

DEMO_USERNAME = 'admin'
DEMO_PASSWORD = 'demo1234'
DEMO_TENANT_SLUG = 'demo'
DEMO_TENANT_NAME = 'Demo Sp. z o.o.'


class Command(BaseCommand):
    help = 'Tworzy konto admina demo i opcjonalnie tenanta demo.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Resetuj hasło admina demo do wartości domyślnej.',
        )

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
            )
            self.stdout.write(self.style.SUCCESS(
                f'Utworzono admina demo: {DEMO_USERNAME} / {DEMO_PASSWORD}'
            ))
        else:
            if user.role != UserRole.ADMIN:
                user.role = UserRole.ADMIN
                user.is_staff = True
                user.is_superuser = True
                user.save(update_fields=['role', 'is_staff', 'is_superuser'])
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

        self.stdout.write(self.style.SUCCESS('Setup demo zakończony.'))
