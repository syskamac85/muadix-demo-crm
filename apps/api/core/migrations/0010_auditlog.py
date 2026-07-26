import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_visit_location_name'),
        ('accounts', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AuditLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('event_type', models.CharField(max_length=64)),
                ('entity_type', models.CharField(max_length=64)),
                ('entity_id', models.PositiveIntegerField()),
                ('changes', models.JSONField(blank=True, default=dict)),
                (
                    'actor',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='audit_logs',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'tenant',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='audit_logs',
                        to='accounts.tenant',
                    ),
                ),
            ],
            options={
                'ordering': ('-created_at',),
            },
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['tenant', 'event_type', 'created_at'], name='core_audit_tenant_evt'),
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['tenant', 'entity_type', 'entity_id'], name='core_audit_entity'),
        ),
    ]
