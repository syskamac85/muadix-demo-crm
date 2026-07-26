import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'api.settings')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
django.setup()

from django.db import connection

with connection.cursor() as cursor:
    # Check if column exists
    cursor.execute("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'core_callrecord' AND column_name = 'contact_time'
    """)
    result = cursor.fetchone()
    
    if result:
        print("Column contact_time already exists")
    else:
        print("Adding column contact_time...")
        cursor.execute("""
            ALTER TABLE core_callrecord 
            ADD COLUMN contact_time time DEFAULT '12:00:00'::time NOT NULL
        """)
        print("Column added successfully!")
