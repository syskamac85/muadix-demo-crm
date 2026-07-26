import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from accounts.models import Tenant
from common.models import TimeStampedModel


class Client(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Aktywny"
        DELETED = "deleted", "Usunięty"

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='clients')
    name = models.CharField(max_length=255)
    nip = models.CharField(max_length=20)
    city = models.CharField(max_length=255, blank=True)
    postal_code = models.CharField(max_length=12, blank=True)
    street = models.CharField(max_length=255, blank=True)
    classification = models.CharField(max_length=120, blank=True)
    salesman = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='clients')
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    location_name = models.CharField(max_length=255, blank=True)
    last_invoice_date = models.DateField(null=True, blank=True)
    type = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=64, blank=True)
    email = models.CharField(max_length=255, blank=True)
    contact_reminder_days = models.PositiveIntegerField(default=0)
    contact_days_label = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['tenant', 'name']),
            models.Index(fields=['tenant', 'nip', 'city']),
        ]
        unique_together = ('tenant', 'nip', 'city')

    def __str__(self) -> str:
        return self.name


class Visit(TimeStampedModel):
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='visits')
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='visits')
    salesman = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='visits')
    planned_at = models.DateTimeField()
    duration_minutes = models.PositiveIntegerField(default=30)
    status = models.CharField(max_length=32, default='planned')
    comment = models.TextField(blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    location_accuracy = models.FloatField(null=True, blank=True, help_text='Accuracy in meters reported by the device GPS.')
    location_name = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ('-planned_at',)

    def __str__(self) -> str:
        return f'{self.client} - {self.planned_at:%Y-%m-%d %H:%M}'


class RoutePlan(TimeStampedModel):
    class ApprovalStatus(models.TextChoices):
        PENDING = 'pending', 'Do akceptacji'
        APPROVED = 'approved', 'Zaakceptowana'
        REJECTED = 'rejected', 'Odrzucona'

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='routes')
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='routes')
    date = models.DateField(default=timezone.now)
    total_drive_minutes = models.PositiveIntegerField(default=0)
    total_visit_minutes = models.PositiveIntegerField(default=0)
    shared_with_manager = models.BooleanField(default=False)
    approval_status = models.CharField(
        max_length=20,
        choices=ApprovalStatus.choices,
        default=ApprovalStatus.PENDING,
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='approved_routes',
    )

    def recalc_totals(self):
        stops = self.stops.all()
        self.total_drive_minutes = sum(stop.drive_minutes for stop in stops)
        self.total_visit_minutes = sum(stop.visit_minutes for stop in stops)
        self.save(update_fields=['total_drive_minutes', 'total_visit_minutes'])

    def __str__(self) -> str:
        return f'{self.owner} - {self.date:%Y-%m-%d}'


class RouteStop(TimeStampedModel):
    route = models.ForeignKey(RoutePlan, on_delete=models.CASCADE, related_name='stops')
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='route_stops')
    order = models.PositiveIntegerField()
    drive_minutes = models.PositiveIntegerField(default=0)
    visit_minutes = models.PositiveIntegerField(default=30)
    arrival_time = models.DateTimeField(null=True, blank=True)
    phone = models.CharField(max_length=64, blank=True)
    email = models.CharField(max_length=255, blank=True)
    comment = models.TextField(blank=True)

    class Meta:
        ordering = ('order',)
        unique_together = ('route', 'order')

    def __str__(self) -> str:
        return f'{self.route} #{self.order} {self.client}'


class Comment(TimeStampedModel):
    PRE_VISIT = 'pre'
    POST_VISIT = 'post'
    COMMENT_TYPES = [
        (PRE_VISIT, 'Pre-visit'),
        (POST_VISIT, 'Post-visit'),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='comments')
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='comments')
    visit = models.ForeignKey(Visit, null=True, blank=True, on_delete=models.SET_NULL, related_name='comments')
    route = models.ForeignKey(RoutePlan, null=True, blank=True, on_delete=models.SET_NULL, related_name='comments')
    body = models.TextField()
    comment_type = models.CharField(max_length=16, choices=COMMENT_TYPES)
    is_editable = models.BooleanField(default=True)

    class Meta:
        ordering = ('-created_at',)

    def __str__(self) -> str:
        return f'{self.client} - {self.comment_type}'


class CallRecord(TimeStampedModel):
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='call_records')
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='call_records')
    handler = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='call_records')
    contact_date = models.DateField(default=timezone.now)
    contact_time = models.TimeField(default=timezone.now)
    next_contact_at = models.DateField(null=True, blank=True)
    outcome = models.CharField(max_length=255, blank=True)
    current_comment = models.TextField(blank=True)
    previous_comment = models.TextField(blank=True)

    class Meta:
        ordering = ('-contact_date', '-contact_time')

    def __str__(self):
        return f'{self.client} - {self.contact_date}'


class AuditLog(TimeStampedModel):
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='audit_logs')
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='audit_logs',
    )
    event_type = models.CharField(max_length=64)
    entity_type = models.CharField(max_length=64)
    entity_id = models.CharField(max_length=64)
    changes = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ('-created_at',)
        indexes = [
            models.Index(fields=['tenant', 'event_type', 'created_at'], name='core_audit_tenant_evt'),
            models.Index(fields=['tenant', 'entity_type', 'entity_id'], name='core_audit_entity'),
        ]

    def __str__(self) -> str:
        return f'{self.event_type} {self.entity_type}#{self.entity_id}'


class ClientDeletionRequest(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Oczekujący'
        APPROVED = 'approved', 'Zatwierdzony'
        REJECTED = 'rejected', 'Odrzucony'

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='client_deletion_requests')
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='deletion_requests')
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='requested_client_deletions',
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    reason = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='reviewed_client_deletions',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ('-created_at',)
        constraints = [
            models.UniqueConstraint(
                fields=['client'],
                condition=Q(status='pending'),
                name='unique_pending_client_deletion_request',
            )
        ]

    def __str__(self) -> str:
        return f'{self.client} – {self.get_status_display()}'


class ImportJob(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        RUNNING = 'running', 'Running'
        SUCCESS = 'success', 'Success'
        ERROR = 'error', 'Error'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='import_jobs')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='import_jobs')
    upload = models.FileField(upload_to='imports/%Y/%m/%d/')
    upload_blob = models.BinaryField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    total_rows = models.PositiveIntegerField(default=0)
    processed_rows = models.PositiveIntegerField(default=0)
    inserted_count = models.PositiveIntegerField(default=0)
    updated_count = models.PositiveIntegerField(default=0)
    geocoded_count = models.PositiveIntegerField(default=0)
    failed_geocode_count = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    cancel_requested = models.BooleanField(default=False)
    failed_geocode_log = models.FileField(upload_to='import_logs/', blank=True)

    class Meta:
        ordering = ('-created_at',)

    @property
    def progress(self) -> float:
        if not self.total_rows:
            return 0.0
        return min(100.0, (self.processed_rows / self.total_rows) * 100)

    def __str__(self) -> str:
        return f'Import {self.pk} ({self.status})'


class ImportRecord(TimeStampedModel):
    ACTION_CHOICES = [
        ('inserted', 'Inserted'),
        ('updated', 'Updated'),
        ('skipped', 'Skipped'),
    ]

    job = models.ForeignKey(ImportJob, on_delete=models.CASCADE, related_name='records')
    order = models.PositiveIntegerField()
    name = models.CharField(max_length=255)
    nip = models.CharField(max_length=20)
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    geocoded = models.BooleanField(default=False)
    message = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=255, blank=True, default='')
    postal_code = models.CharField(max_length=20, blank=True, default='')
    street = models.CharField(max_length=255, blank=True, default='')

    class Meta:
        ordering = ('order',)

    def __str__(self) -> str:
        return f'{self.job_id} #{self.order} {self.name}'


class BackupJob(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = 'pending', 'W kolejce'
        RUNNING = 'running', 'W trakcie'
        SUCCESS = 'success', 'Zakończony'
        ERROR = 'error', 'Błąd'

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='backup_jobs')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='backup_jobs')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    file = models.FileField(upload_to='backups/%Y/%m/%d/', blank=True)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ('-created_at',)

    def __str__(self) -> str:
        return f'Backup {self.pk} ({self.status})'


class BackupJob(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = 'pending', 'W kolejce'
        RUNNING = 'running', 'W trakcie'
        SUCCESS = 'success', 'Zakończony'
        ERROR = 'error', 'Błąd'

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='backup_jobs')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='backup_jobs')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    file = models.FileField(upload_to='backups/%Y/%m/%d/', blank=True)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ('-created_at',)

    def __str__(self) -> str:
        return f'Backup {self.pk} ({self.status})'

class Task(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Nowe'
        IN_PROGRESS = 'in_progress', 'W trakcie'
        AWAITING_REVIEW = 'awaiting_review', 'Do potwierdzenia'
        COMPLETED = 'completed', 'Zamknięte'
        CANCELLED = 'cancelled', 'Anulowane'

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='tasks')
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='tasks')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='created_tasks',
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='assigned_tasks',
    )
    title = models.CharField(max_length=255)
    description = models.TextField()
    due_date = models.DateField()
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.PENDING)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='completed_tasks',
    )

    class Meta:
        ordering = ('-created_at',)
        indexes = [
            models.Index(fields=['tenant', 'assigned_to', 'status']),
            models.Index(fields=['tenant', 'client']),
            models.Index(fields=['tenant', 'due_date']),
        ]

    def __str__(self) -> str:
        return f'{self.title} ({self.get_status_display()})'

    @property
    def days_until_due(self) -> int | None:
        if not self.due_date:
            return None
        return (self.due_date - timezone.localdate()).days


class TaskMessage(TimeStampedModel):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='messages')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='task_messages')
    body = models.TextField()
    is_completion = models.BooleanField(default=False)
    is_manager_reply = models.BooleanField(default=False)
    status_snapshot = models.CharField(max_length=32, blank=True)
    due_date_update = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ('created_at',)

    def __str__(self) -> str:
        return f'{self.task_id} - {self.author_id}'


class ContactNextDateRequest(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING  = 'pending',  'Oczekujący'
        APPROVED = 'approved', 'Zatwierdzony'
        REJECTED = 'rejected', 'Odrzucony'

    tenant       = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='contact_next_date_requests')
    call_record  = models.ForeignKey('CallRecord', on_delete=models.CASCADE, related_name='next_date_requests')
    client       = models.ForeignKey('Client', on_delete=models.CASCADE, related_name='next_date_requests')
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='contact_next_date_requests',
    )
    cycle_days   = models.PositiveIntegerField()
    proposed_days = models.PositiveIntegerField()
    status       = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    reason       = models.TextField(blank=True)
    reviewed_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='reviewed_contact_next_date_requests',
    )
    reviewed_at  = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ('-created_at',)
        constraints = [
            models.UniqueConstraint(
                fields=['call_record'],
                condition=Q(status='pending'),
                name='unique_pending_contact_next_date_request',
            )
        ]

    def __str__(self) -> str:
        return f'{self.client} – {self.proposed_days}d vs {self.cycle_days}d ({self.get_status_display()})'
