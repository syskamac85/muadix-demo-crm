#!/usr/bin/env python
"""Fix missing contact_time column in core_callrecord table"""
import os
import sys

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'api.settings')

# Add apps/api to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import django
django.setup()

from django.db import connection

def fix_database():
    with connection.cursor() as cursor:
        # Check if column exists
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'core_callrecord' AND column_name = 'contact_time'
        """)
        result = cursor.fetchone()
        
        if result:
            print("✓ Column contact_time already exists")
            return True
        else:
            print("→ Adding column contact_time...")
            try:
                cursor.execute("""
                    ALTER TABLE core_callrecord 
                    ADD COLUMN contact_time time DEFAULT '12:00:00'::time NOT NULL
                """)
                print("✓ Column added successfully!")
                return True
            except Exception as e:
                print(f"✗ Error: {e}")
                return False

if __name__ == "__main__":
    success = fix_database()
    sys.exit(0 if success else 1)
