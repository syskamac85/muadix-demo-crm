from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_alter_importrecord_city_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="routestop",
            name="phone",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="routestop",
            name="email",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="routestop",
            name="comment",
            field=models.TextField(blank=True),
        ),
    ]
