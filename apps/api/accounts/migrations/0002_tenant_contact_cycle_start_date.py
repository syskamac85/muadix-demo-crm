from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenant",
            name="contact_cycle_start_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
