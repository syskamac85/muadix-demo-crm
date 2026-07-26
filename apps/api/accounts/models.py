from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models

from common.models import TimeStampedModel


class Tenant(TimeStampedModel):
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    contact_cycle_start_date = models.DateField(null=True, blank=True)

    def __str__(self) -> str:
        return self.name


class UserRole(models.TextChoices):
    ADMIN = 'admin', 'Admin'
    MANAGER = 'manager', 'Manager'
    REP = 'rep', 'Sales Rep'


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, username, email, password, **extra_fields):
        if not username:
            raise ValueError('Username must be set')
        email = self.normalize_email(email)
        user = self.model(username=username, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', False)
        extra_fields.setdefault('is_superuser', False)
        return self._create_user(username, email, password, **extra_fields)

    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('role', UserRole.ADMIN)

        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')

        return self._create_user(username, email, password, **extra_fields)


class User(AbstractUser):
    tenant = models.ForeignKey(Tenant, null=True, blank=True, on_delete=models.SET_NULL, related_name='users')
    role = models.CharField(max_length=20, choices=UserRole.choices, default=UserRole.REP)
    contact_cycle_start_date = models.DateField(null=True, blank=True)

    objects = UserManager()

    @property
    def is_manager(self):
        return self.role in {UserRole.ADMIN, UserRole.MANAGER}

    class Meta:
        verbose_name = 'User'
        verbose_name_plural = 'Users'
