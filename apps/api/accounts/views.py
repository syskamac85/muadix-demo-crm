from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Tenant, UserRole
from .serializers import (
    CurrentUserSerializer,
    ManagerAdminSerializer,
    SalesRepAdminSerializer,
    TenantSerializer,
    UserSerializer,
)

User = get_user_model()


class TenantViewSet(viewsets.ModelViewSet):
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer
    permission_classes = [permissions.IsAdminUser]

    @action(detail=True, methods=['patch'], url_path='contact-cycle-start')
    def update_contact_cycle_start(self, request, pk=None):
        tenant = self.get_object()
        start_date_value = request.data.get('start_date')

        if start_date_value in (None, '', 'null'):
            tenant.contact_cycle_start_date = None
        else:
            try:
                start_date = Tenant._meta.get_field('contact_cycle_start_date').to_python(start_date_value)
            except Exception:
                return Response(
                    {'start_date': 'Nieprawidłowy format daty. Użyj RRRR-MM-DD.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if start_date is None:
                return Response(
                    {'start_date': 'Nieprawidłowy format daty. Użyj RRRR-MM-DD.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            tenant.contact_cycle_start_date = start_date

        tenant.save(update_fields=['contact_cycle_start_date'])
        serializer = self.get_serializer(tenant)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def current(self, request):
        tenant = getattr(request.user, 'tenant', None)
        if not tenant:
            tenant = Tenant.objects.first()
        if not tenant:
            return Response({'detail': 'Brak zdefiniowanego tenanta.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = self.get_serializer(tenant)
        return Response(serializer.data)


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related('tenant').all()
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAdminUser]

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def me(self, request):
        serializer = CurrentUserSerializer(request.user)
        return Response(serializer.data)


class IsAdminOrManager(permissions.BasePermission):
    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return False
        return user.role in {UserRole.ADMIN, UserRole.MANAGER}


class ManagerAdminViewSet(viewsets.ModelViewSet):
    serializer_class = ManagerAdminSerializer
    permission_classes = [IsAdminOrManager]

    def get_queryset(self):
        queryset = User.objects.filter(role__in=[UserRole.ADMIN, UserRole.MANAGER]).select_related('tenant')
        user = self.request.user
        if user.role == UserRole.ADMIN:
            return queryset
        if user.role == UserRole.MANAGER:
            return queryset.filter(pk=user.pk)
        return queryset.none()

    def create(self, request, *args, **kwargs):
        if request.user.role != UserRole.ADMIN:
            return Response({'detail': 'Brak dostępu.'}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if request.user.role != UserRole.ADMIN:
            return Response({'detail': 'Brak dostępu.'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(role=UserRole.MANAGER)

    @action(detail=True, methods=['post'])
    def set_password(self, request, pk=None):
        manager = self.get_object()
        if request.user.role != UserRole.ADMIN and request.user != manager:
            return Response({'detail': 'Brak dostępu.'}, status=status.HTTP_403_FORBIDDEN)

        password = request.data.get('password')
        if not password:
            return Response({'password': 'Hasło jest wymagane.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(password, user=manager)
        except Exception as exc:
            return Response({'password': exc.messages}, status=status.HTTP_400_BAD_REQUEST)

        manager.set_password(password)
        manager.save(update_fields=['password'])

        return Response({'detail': 'Hasło zaktualizowane.'})


class SalesRepViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = User.objects.filter(role=UserRole.REP).select_related('tenant')
        user = self.request.user
        if user.role == UserRole.ADMIN:
            return queryset
        if user.tenant_id:
            return queryset.filter(tenant=user.tenant)
        return queryset.none()


class SalesRepAdminViewSet(viewsets.ModelViewSet):
    serializer_class = SalesRepAdminSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = User.objects.filter(role=UserRole.REP).select_related('tenant')
        user = self.request.user
        if user.role == UserRole.ADMIN:
            return queryset
        if user.tenant_id:
            return queryset.filter(tenant=user.tenant)
        return queryset.none()

    def perform_create(self, serializer):
        serializer.save(role=UserRole.REP)

    @action(detail=True, methods=['post'])
    def set_password(self, request, pk=None):
        rep = self.get_object()
        if request.user.role != UserRole.ADMIN and request.user.tenant_id != rep.tenant_id:
            return Response({'detail': 'Brak dostępu.'}, status=status.HTTP_403_FORBIDDEN)

        password = request.data.get('password')
        if not password:
            return Response({'password': 'Hasło jest wymagane.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(password, user=rep)
        except Exception as exc:  # Django raises ValidationError list
            return Response({'password': exc.messages}, status=status.HTTP_400_BAD_REQUEST)

        rep.set_password(password)
        rep.save(update_fields=['password'])

        return Response({'detail': 'Hasło zaktualizowane.'})


class DemoTokenView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        user = User.objects.filter(role=UserRole.ADMIN, is_active=True).first()
        if not user:
            user = User.objects.filter(is_superuser=True, is_active=True).first()
        if not user:
            return Response(
                {'detail': 'Demo admin nie istnieje. Uruchom: python manage.py setup_demo'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        }, status=status.HTTP_200_OK)


class SecureTokenObtainPairView(TokenObtainPairView):
    RATE_LIMIT = 5  # max failed attempts per window
    RATE_WINDOW_SECONDS = 60
    LOCKOUT_THRESHOLD = 5  # consecutive failures before lockout
    LOCKOUT_DURATION_SECONDS = 300

    def post(self, request, *args, **kwargs):
        ip, username = self._identify(request)
        ip_lock_key = self._ip_lock_cache_key(ip)
        if cache.get(ip_lock_key):
            return Response(
                {'detail': 'Zbyt wiele nieudanych prób logowania. Spróbuj ponownie za 5 minut.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        lock_key = self._lockout_cache_key(ip, username)
        if cache.get(lock_key):
            return Response(
                {'detail': 'Zbyt wiele nieudanych prób logowania. Spróbuj ponownie za 5 minut.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        attempts_key = self._attempt_cache_key(ip, username)
        attempts = cache.get(attempts_key, 0)
        if attempts >= self.RATE_LIMIT:
            return Response(
                {'detail': 'Zbyt wiele prób logowania. Odczekaj minutę i spróbuj ponownie.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except Exception:
            self._record_failure(ip, username)
            raise

        self._reset_counters(ip, username)
        return Response(serializer.validated_data, status=status.HTTP_200_OK)

    def _identify(self, request):
        forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
        if forwarded:
            ip = forwarded.split(',')[0].strip()
        else:
            ip = request.META.get('REMOTE_ADDR', '') or 'unknown'
        username = (request.data.get('username') or '').strip().lower() or 'anonymous'
        return ip, username

    def _attempt_cache_key(self, ip, username):
        return self._cache_key(ip, username, 'attempts')

    def _failure_cache_key(self, ip, username):
        return self._cache_key(ip, username, 'failures')

    def _lockout_cache_key(self, ip, username):
        return self._cache_key(ip, username, 'lockout')

    def _ip_lock_cache_key(self, ip):
        safe_ip = ip.replace(':', '_') or 'ip'
        return f'auth:{safe_ip}:lockout'

    @staticmethod
    def _cache_key(ip, username, suffix):
        safe_ip = ip.replace(':', '_')
        safe_username = ''.join(ch for ch in username if ch.isalnum()) or 'user'
        return f'auth:{safe_ip}:{safe_username}:{suffix}'

    def _record_failure(self, ip, username):
        attempts_key = self._attempt_cache_key(ip, username)
        attempts = cache.get(attempts_key, 0) + 1
        cache.set(attempts_key, attempts, timeout=self.RATE_WINDOW_SECONDS)

        failure_key = self._failure_cache_key(ip, username)
        failures = cache.get(failure_key, 0) + 1
        cache.set(failure_key, failures, timeout=self.LOCKOUT_DURATION_SECONDS)

        if failures >= self.LOCKOUT_THRESHOLD:
            lock_key = self._lockout_cache_key(ip, username)
            cache.set(lock_key, True, timeout=self.LOCKOUT_DURATION_SECONDS)
            cache.set(self._ip_lock_cache_key(ip), True, timeout=self.LOCKOUT_DURATION_SECONDS)
            cache.delete(failure_key)

    def _reset_counters(self, ip, username):
        cache.delete(self._attempt_cache_key(ip, username))
        cache.delete(self._failure_cache_key(ip, username))
