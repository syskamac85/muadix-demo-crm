from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0014_alter_client_contact_days_label"),
    ]

    operations = [
        migrations.AddField(
            model_name="client",
            name="contact_cycle_start_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
