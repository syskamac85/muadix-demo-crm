from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Tenant, UserRole

User = get_user_model()


class TenantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = ['id', 'name', 'slug', 'contact_cycle_start_date', 'created_at', 'updated_at']


class UserSerializer(serializers.ModelSerializer):
    tenant = TenantSerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(),
        source='tenant',
        write_only=True,
        required=False,
    )

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'role',
            'tenant',
            'tenant_id',
            'is_active',
            'is_staff',
            'date_joined',
            'contact_cycle_start_date',
        ]
        read_only_fields = ('is_staff', 'date_joined')


class CurrentUserSerializer(serializers.ModelSerializer):
    tenant = TenantSerializer(read_only=True)

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'role',
            'tenant',
            'contact_cycle_start_date',
        ]


class SalesRepAdminSerializer(serializers.ModelSerializer):
    tenant = TenantSerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(),
        source='tenant',
        write_only=True,
        required=False,
    )
    password = serializers.CharField(write_only=True, required=False, allow_blank=False, min_length=6)

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'is_active',
            'role',
            'tenant',
            'tenant_id',
            'password',
            'contact_cycle_start_date',
        ]
        read_only_fields = ('id', 'tenant', 'role')

    def validate(self, attrs):
        request = self.context['request']
        user = request.user
        tenant = attrs.get('tenant')

        if user.role != UserRole.ADMIN:
            attrs['tenant'] = user.tenant
        elif tenant is None:
            raise serializers.ValidationError({'tenant_id': 'Wybierz tenant dla nowego handlowca.'})

        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        if not password:
            raise serializers.ValidationError({'password': 'Hasło jest wymagane.'})
        validated_data.pop('role', None)
        return User.objects.create_user(role=UserRole.REP, password=password, **validated_data)

    def update(self, instance, validated_data):
        # password should only be handled via dedicated endpoint
        validated_data.pop('password', None)

        # managers cannot reassign tenants
        request = self.context['request']
        if request.user.role != UserRole.ADMIN and 'tenant' in validated_data:
            validated_data.pop('tenant', None)

        return super().update(instance, validated_data)


class ManagerAdminSerializer(serializers.ModelSerializer):
    tenant = TenantSerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(),
        source='tenant',
        write_only=True,
        required=False,
    )
    password = serializers.CharField(write_only=True, required=False, allow_blank=False, min_length=6)

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'is_active',
            'tenant',
            'tenant_id',
            'password',
            'contact_cycle_start_date',
        ]
        read_only_fields = ('id', 'tenant')

    def validate(self, attrs):
        request = self.context['request']
        user = request.user
        tenant = attrs.get('tenant')

        if user.role != UserRole.ADMIN:
            attrs['tenant'] = user.tenant
        elif tenant is None:
            raise serializers.ValidationError({'tenant_id': 'Wybierz tenant dla menedżera.'})

        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        if not password:
            raise serializers.ValidationError({'password': 'Hasło jest wymagane.'})
        validated_data.pop('role', None)
        return User.objects.create_user(role=UserRole.MANAGER, password=password, **validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('password', None)

        request = self.context['request']
        if request.user.role != UserRole.ADMIN and 'tenant' in validated_data:
            validated_data.pop('tenant', None)

        return super().update(instance, validated_data)
