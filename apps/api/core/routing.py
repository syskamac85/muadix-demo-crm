from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/import/(?P<job_id>[0-9a-f-]+)/$', consumers.ImportJobConsumer.as_asgi()),
    re_path(r'ws/tasks/(?P<tenant_id>[^/]+)/$', consumers.TaskConsumer.as_asgi()),
]
