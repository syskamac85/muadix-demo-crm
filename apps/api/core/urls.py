from django.urls import path, re_path
from rest_framework.routers import DefaultRouter

from .views import (
    AuditLogViewSet,
    BackupJobViewSet,
    CallRecordViewSet,
    ClientViewSet,
    ClientDeletionRequestViewSet,
    ContactNextDateRequestViewSet,
    TenantContactCycleCompatView,
    CommentViewSet,
    ImportJobViewSet,
    RoutePlanViewSet,
    TaskViewSet,
    TenantViewSet,
    VisitViewSet,
)
from .plain_report_view import plain_contact_report, plain_completed_export, plain_contact_stats_history

router = DefaultRouter()
router.register(r'tenants', TenantViewSet)
router.register(r'clients', ClientViewSet, basename='client')
router.register(r'client-deletion-requests', ClientDeletionRequestViewSet, basename='client-deletion-request')
router.register(r'visits', VisitViewSet)
router.register(r'routes', RoutePlanViewSet)
router.register(r'comments', CommentViewSet)
router.register(r'call-records', CallRecordViewSet, basename='call-record')
router.register(r'audit-logs', AuditLogViewSet, basename='audit-log')
router.register(r'import-jobs', ImportJobViewSet, basename='import-job')
router.register(r'backups', BackupJobViewSet, basename='backup')
router.register(r'tasks', TaskViewSet, basename='task')
router.register(r'contact-next-date-requests', ContactNextDateRequestViewSet, basename='contact-next-date-request')

urlpatterns = [
    re_path(r'^clients/contact-report/$', plain_contact_report, name='client-contact-report'),
    re_path(r'^clients/contact-stats/history/$', plain_contact_stats_history, name='client-contact-stats-history'),
    re_path(r'^clients/tenants/(?P<tenant_id>[0-9]+)/$', TenantContactCycleCompatView.as_view(), name='client-tenant-contact-cycle'),
    path('clients/contact-plan/', ClientViewSet.as_view({'get': 'contact_plan'}), name='client-contact-plan'),
    path('clients/contact-stats/', ClientViewSet.as_view({'get': 'contact_stats'}), name='client-contact-stats'),
    path('clients/<int:pk>/call-history/', ClientViewSet.as_view({'get': 'call_history'}), name='client-call-history'),
    path('clients/<int:pk>/contact-plan/complete/', ClientViewSet.as_view({'post': 'mark_contact_completed'}), name='client-contact-complete'),
    path('call-records-completed-export/', plain_completed_export, name='call-records-export'),
] + router.urls + [
    path('routes/<int:pk>/approve/', RoutePlanViewSet.as_view({'post': 'approve'}), name='routeplan-approve'),
    path('routes/<int:pk>/reject/', RoutePlanViewSet.as_view({'post': 'reject'}), name='routeplan-reject'),
    path('contact-next-date-requests/<int:pk>/approve/', ContactNextDateRequestViewSet.as_view({'post': 'approve'}), name='contact-next-date-request-approve'),
    path('contact-next-date-requests/<int:pk>/reject/', ContactNextDateRequestViewSet.as_view({'post': 'reject'}), name='contact-next-date-request-reject'),
]
