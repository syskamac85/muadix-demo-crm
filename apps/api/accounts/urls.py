from rest_framework.routers import DefaultRouter

from .views import (
    ManagerAdminViewSet,
    SalesRepAdminViewSet,
    SalesRepViewSet,
    TenantViewSet,
    UserViewSet,
)

router = DefaultRouter()
router.register(r'tenants', TenantViewSet, basename='accounts-tenant')
router.register(r'users', UserViewSet, basename='accounts-user')
router.register(r'managers', ManagerAdminViewSet, basename='accounts-manager')
router.register(r'sales-reps', SalesRepViewSet, basename='accounts-sales-rep')
router.register(r'sales-reps-admin', SalesRepAdminViewSet, basename='accounts-sales-rep-admin')

urlpatterns = router.urls
