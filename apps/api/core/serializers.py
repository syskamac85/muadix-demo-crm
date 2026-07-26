from urllib.parse import quote

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import (
    AuditLog,
    BackupJob,
    CallRecord,
    Client,
    ClientDeletionRequest,
    Comment,
    ContactNextDateRequest,
    ImportJob,
    ImportRecord,
    RoutePlan,
    RouteStop,
    Task,
    TaskMessage,
    Tenant,
    Visit,
)

User = get_user_model()


class TenantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = ['id', 'name', 'slug', 'created_at', 'updated_at']


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name']


class ClientSerializer(serializers.ModelSerializer):
    salesman = UserSerializer(read_only=True)
    salesman_id = serializers.PrimaryKeyRelatedField(
        source='salesman',
        queryset=User.objects.all(),
        write_only=True,
        allow_null=True,
        required=False,
    )

    class Meta:
        model = Client
        fields = [
            'id',
            'tenant',
            'name',
            'nip',
            'city',
            'postal_code',
            'street',
            'classification',
            'salesman',
            'salesman_id',
            'latitude',
            'longitude',
            'location_name',
            'last_invoice_date',
            'type',
            'phone',
            'email',
            'contact_reminder_days',
            'contact_days_label',
            'status',
            'deleted_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['deleted_at', 'status']


class ClientDeletionRequestSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source='client.name', read_only=True)
    requested_by_name = serializers.CharField(source='requested_by.username', read_only=True)
    reviewed_by_name = serializers.CharField(source='reviewed_by.username', read_only=True)

    class Meta:
        model = ClientDeletionRequest
        fields = [
            'id',
            'tenant',
            'client',
            'client_name',
            'requested_by',
            'requested_by_name',
            'status',
            'reason',
            'reviewed_by',
            'reviewed_by_name',
            'reviewed_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'tenant',
            'status',
            'reviewed_by',
            'reviewed_by_name',
            'reviewed_at',
            'created_at',
            'updated_at',
            'client_name',
            'requested_by_name',
        ]


class ContactNextDateRequestSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    requested_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ContactNextDateRequest
        fields = [
            'id',
            'tenant',
            'call_record',
            'client',
            'client_name',
            'requested_by',
            'requested_by_name',
            'cycle_days',
            'proposed_days',
            'status',
            'reason',
            'reviewed_by',
            'reviewed_by_name',
            'reviewed_at',
            'created_at',
        ]
        read_only_fields = [
            'tenant', 'call_record', 'client', 'client_name',
            'requested_by', 'requested_by_name', 'cycle_days', 'proposed_days',
            'status', 'reviewed_by', 'reviewed_by_name', 'reviewed_at', 'created_at',
        ]

    def get_client_name(self, obj) -> str:
        return obj.client.name if obj.client_id else ''

    def get_requested_by_name(self, obj) -> str:
        u = obj.requested_by
        if not u:
            return ''
        full = f"{u.first_name or ''} {u.last_name or ''}".strip()
        return full or u.username

    def get_reviewed_by_name(self, obj) -> str:
        u = obj.reviewed_by
        if not u:
            return ''
        full = f"{u.first_name or ''} {u.last_name or ''}".strip()
        return full or u.username


class VisitSerializer(serializers.ModelSerializer):
    class Meta:
        model = Visit
        fields = [
            'id',
            'tenant',
            'client',
            'salesman',
            'planned_at',
            'duration_minutes',
            'status',
            'comment',
            'latitude',
            'longitude',
            'location_accuracy',
            'location_name',
            'created_at',
            'updated_at',
        ]
        extra_kwargs = {
            'tenant': {'read_only': True},
        }


class AuditLogSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(source='actor.username', read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            'id',
            'tenant',
            'actor',
            'actor_username',
            'event_type',
            'entity_type',
            'entity_id',
            'changes',
            'created_at',
        ]
        read_only_fields = fields


class RouteStopSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source='client.name', read_only=True)
    client_city = serializers.CharField(source='client.city', read_only=True)
    client_street = serializers.CharField(source='client.street', read_only=True)
    client_postal_code = serializers.CharField(source='client.postal_code', read_only=True)
    client_latitude = serializers.FloatField(source='client.latitude', read_only=True)
    client_longitude = serializers.FloatField(source='client.longitude', read_only=True)

    class Meta:
        model = RouteStop
        fields = [
            'id',
            'route',
            'client',
            'order',
            'drive_minutes',
            'visit_minutes',
            'arrival_time',
            'phone',
            'email',
            'comment',
            'client_name',
            'client_city',
            'client_street',
            'client_postal_code',
            'client_latitude',
            'client_longitude',
            'created_at',
            'updated_at',
        ]
        extra_kwargs = {
            'route': {'read_only': True},
        }


class TaskMessageSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source='author.username', read_only=True)
    author_role = serializers.CharField(source='author.role', read_only=True)

    class Meta:
        model = TaskMessage
        fields = [
            'id',
            'task',
            'author',
            'author_name',
            'author_role',
            'body',
            'is_completion',
            'is_manager_reply',
            'created_at',
        ]
        read_only_fields = fields


class TaskSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source='client.name', read_only=True)
    client_city = serializers.CharField(source='client.city', read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.username', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    days_until_due = serializers.SerializerMethodField()
    messages = TaskMessageSerializer(many=True, read_only=True)

    class Meta:
        model = Task
        fields = [
            'id',
            'tenant',
            'client',
            'client_name',
            'client_city',
            'title',
            'description',
            'due_date',
            'days_until_due',
            'status',
            'created_by',
            'created_by_name',
            'assigned_to',
            'assigned_to_name',
            'completed_at',
            'completed_by',
            'messages',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'tenant',
            'created_by',
            'created_by_name',
            'assigned_to_name',
            'completed_at',
            'completed_by',
            'messages',
            'days_until_due',
            'created_at',
            'updated_at',
        ]

    def get_days_until_due(self, obj: Task) -> int | None:
        return obj.days_until_due


class BackupJobSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = BackupJob
        fields = [
            'id',
            'tenant',
            'created_by',
            'created_by_name',
            'status',
            'error_message',
            'file',
            'file_url',
            'started_at',
            'finished_at',
            'created_at',
        ]
        read_only_fields = fields

    def get_file_url(self, obj: BackupJob) -> str | None:
        request = self.context.get('request')
        if obj.file and request is not None:
            return request.build_absolute_uri(obj.file.url)
        if obj.file:
            return obj.file.url
        return None



class RoutePlanSerializer(serializers.ModelSerializer):
    stops = RouteStopSerializer(many=True)
    owner_name = serializers.StringRelatedField(source='owner', read_only=True)
    approved_by_name = serializers.StringRelatedField(source='approved_by', read_only=True)
    owner_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        source='owner',
        write_only=True,
        required=False,
    )

    class Meta:
        model = RoutePlan
        fields = [
            'id',
            'tenant',
            'owner',
            'owner_id',
            'owner_name',
            'date',
            'total_drive_minutes',
            'total_visit_minutes',
            'shared_with_manager',
            'approval_status',
            'approved_at',
            'approved_by',
            'approved_by_name',
            'stops',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'tenant',
            'owner',
            'total_drive_minutes',
            'total_visit_minutes',
            'created_at',
            'updated_at',
            'approval_status',
            'approved_at',
            'approved_by',
            'approved_by_name',
        ]

    def create(self, validated_data):
        stops_data = validated_data.pop('stops', [])
        route = RoutePlan.objects.create(**validated_data)
        self._replace_stops(route, stops_data)
        route.recalc_totals()
        return route

    def update(self, instance, validated_data):
        stops_data = validated_data.pop('stops', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if stops_data is not None:
            instance.stops.all().delete()
            self._replace_stops(instance, stops_data)
        instance.recalc_totals()
        return instance

    def _replace_stops(self, route: RoutePlan, stops_data):
        for index, stop_data in enumerate(stops_data, start=1):
            client_value = stop_data.get('client')
            if isinstance(client_value, Client):
                client = client_value
            else:
                client = Client.objects.filter(pk=client_value).first()
            if not client:
                raise serializers.ValidationError(
                    {'stops': f'Nie znaleziono klienta o id {client_value}.'}
                )
            RouteStop.objects.create(
                route=route,
                client=client,
                order=stop_data.get('order') or index,
                drive_minutes=stop_data.get('drive_minutes', 0),
                visit_minutes=stop_data.get('visit_minutes', 0),
                arrival_time=stop_data.get('arrival_time'),
                phone=stop_data.get('phone', ''),
                email=stop_data.get('email', ''),
                comment=stop_data.get('comment', ''),
            )


class CommentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Comment
        fields = [
            'id',
            'tenant',
            'author',
            'client',
            'visit',
            'route',
            'body',
            'comment_type',
            'is_editable',
            'created_at',
            'updated_at',
        ]


class CallRecordSerializer(serializers.ModelSerializer):
    handler = serializers.StringRelatedField(read_only=True)
    handler_id = serializers.IntegerField(read_only=True)
    handler_name = serializers.SerializerMethodField()
    contact_time = serializers.SerializerMethodField()
    cycle_days = serializers.SerializerMethodField()

    class Meta:
        model = CallRecord
        fields = [
            'id',
            'tenant',
            'client',
            'handler',
            'handler_id',
            'handler_name',
            'contact_date',
            'contact_time',
            'next_contact_at',
            'outcome',
            'current_comment',
            'previous_comment',
            'cycle_days',
            'created_at',
            'updated_at',
        ]
        extra_kwargs = {
            'tenant': {'read_only': True},
            'handler': {'required': False, 'allow_null': True},
        }

    def get_handler_name(self, obj: CallRecord) -> str:
        handler = getattr(obj, 'handler', None)
        if not handler:
            return ''
        first_name = (handler.first_name or '').strip()
        last_name = (handler.last_name or '').strip()
        full_name = ' '.join(part for part in [first_name, last_name] if part)
        return full_name or handler.get_username()

    def get_contact_time(self, obj: CallRecord) -> str | None:
        if obj.contact_time:
            # Convert time or datetime to string
            if hasattr(obj.contact_time, 'time'):
                return obj.contact_time.time().isoformat()
            return obj.contact_time.isoformat()
        return None

    def get_cycle_days(self, obj: CallRecord) -> int | None:
        client = getattr(obj, 'client', None)
        if not client:
            return None
        # Resolve cycle days from client (contact_days_label takes precedence)
        label = getattr(client, 'contact_days_label', '') or ''
        stripped = label.strip()
        if stripped:
            try:
                return int(stripped)
            except ValueError:
                pass
        reminder = getattr(client, 'contact_reminder_days', None)
        if reminder:
            return int(reminder) if reminder else None
        return None


class ImportRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportRecord
        fields = [
            'id',
            'order',
            'name',
            'nip',
            'action',
            'geocoded',
            'message',
            'city',
            'postal_code',
            'street',
            'created_at',
        ]


class ImportJobSerializer(serializers.ModelSerializer):
    records = ImportRecordSerializer(many=True, read_only=True)
    progress = serializers.SerializerMethodField()
    created_by = serializers.StringRelatedField()
    cancel_requested = serializers.BooleanField(read_only=True)

    class Meta:
        model = ImportJob
        fields = [
            'id',
            'tenant',
            'created_by',
            'status',
            'total_rows',
            'processed_rows',
            'inserted_count',
            'updated_count',
            'geocoded_count',
            'failed_geocode_count',
            'progress',
            'error_message',
            'created_at',
            'started_at',
            'finished_at',
            'cancel_requested',
            'records',
        ]
        read_only_fields = fields

    def get_progress(self, obj: ImportJob) -> float:
        return round(obj.progress, 2)
