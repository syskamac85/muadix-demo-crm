from django.contrib import admin

from .models import CallRecord, Client, Comment, ContactNextDateRequest, RoutePlan, RouteStop, Task, TaskMessage, Visit


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = (
        'name',
        'nip',
        'city',
        'postal_code',
        'street',
        'classification',
        'type',
        'salesman',
        'tenant',
        'contact_days_label',
        'created_at',
    )
    search_fields = ('name', 'nip', 'city', 'postal_code', 'salesman__email')
    list_filter = ('tenant', 'classification', 'salesman', 'type')
    ordering = ('-created_at',)


class RouteStopInline(admin.TabularInline):
    model = RouteStop
    extra = 0


@admin.register(RoutePlan)
class RoutePlanAdmin(admin.ModelAdmin):
    list_display = ('owner', 'date', 'total_drive_minutes', 'total_visit_minutes', 'shared_with_manager', 'tenant')
    list_filter = ('tenant', 'owner', 'date', 'shared_with_manager')
    inlines = [RouteStopInline]


@admin.register(Visit)
class VisitAdmin(admin.ModelAdmin):
    list_display = ('client', 'salesman', 'planned_at', 'status', 'tenant')
    list_filter = ('tenant', 'salesman', 'status')
    search_fields = ('client__name', 'salesman__email')


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ('client', 'author', 'comment_type', 'created_at', 'tenant')
    list_filter = ('tenant', 'comment_type')
    search_fields = ('client__name', 'author__email', 'body')


@admin.register(CallRecord)
class CallRecordAdmin(admin.ModelAdmin):
    list_display = ('client', 'handler', 'contact_date', 'next_contact_at', 'tenant')
    list_filter = ('tenant', 'handler')
    search_fields = ('client__name', 'handler__email')


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = (
        'title',
        'client',
        'assigned_to',
        'status',
        'due_date',
        'tenant',
        'created_at',
    )
    list_filter = ('tenant', 'status', 'assigned_to')
    search_fields = ('title', 'client__name', 'assigned_to__username', 'created_by__username')
    ordering = ('-created_at',)


@admin.register(TaskMessage)
class TaskMessageAdmin(admin.ModelAdmin):
    list_display = ('task', 'author', 'is_completion', 'is_manager_reply', 'created_at')
    list_filter = ('is_completion', 'is_manager_reply', 'author')
    search_fields = ('task__title', 'author__username', 'body')


@admin.register(ContactNextDateRequest)
class ContactNextDateRequestAdmin(admin.ModelAdmin):
    list_display = ('client', 'requested_by', 'cycle_days', 'proposed_days', 'status', 'created_at', 'tenant')
    list_filter = ('tenant', 'status')
    search_fields = ('client__name', 'requested_by__username')
    ordering = ('-created_at',)
    readonly_fields = ('tenant', 'call_record', 'client', 'requested_by', 'cycle_days', 'proposed_days', 'created_at')
