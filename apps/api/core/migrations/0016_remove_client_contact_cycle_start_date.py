from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0015_client_contact_cycle_start_date"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="client",
            name="contact_cycle_start_date",
        ),
    ]
