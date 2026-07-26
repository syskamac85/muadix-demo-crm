from __future__ import annotations

from typing import Any, Dict, List

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import AnonymousUser

from accounts.models import UserRole
from .broadcast import serialize_job, serialize_record, serialize_task, serialize_task_message
from .models import ImportJob, ImportRecord, Task, TaskMessage


class ImportJobConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.job_id = self.scope['url_route']['kwargs'].get('job_id')
        self.group_name = f'import_{self.job_id}'
        self.user = self.scope.get('user') or AnonymousUser()

        job = await self._get_job()
        if not job or not await self._can_access(job):
            await self.close(code=4403)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self._send_snapshot(job)

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def job_update(self, event: Dict[str, Any]):
        await self.send_json({'type': 'job.update', 'payload': event['payload']})

    async def job_log(self, event: Dict[str, Any]):
        await self.send_json({'type': 'job.log', 'payload': event['payload']})

    async def _get_job(self) -> ImportJob | None:
        try:
            return await sync_to_async(ImportJob.objects.select_related('tenant', 'created_by').get)(pk=self.job_id)
        except ImportJob.DoesNotExist:
            return None

    async def _can_access(self, job: ImportJob) -> bool:
        user = self.user
        if not user.is_authenticated:
            return False
        if user.role == UserRole.ADMIN:
            return True
        if user.role == UserRole.MANAGER and user.tenant_id == job.tenant_id:
            return True
        if user.role == UserRole.REP and user.tenant_id == job.tenant_id and job.created_by_id == user.id:
            return True
        return False

    async def _send_snapshot(self, job: ImportJob) -> None:
        latest_records: List[ImportRecord] = await sync_to_async(list)(
            ImportRecord.objects.filter(job=job).order_by('-order')[:20]
        )
        payload = serialize_job(job)
        payload['records'] = [serialize_record(record) for record in reversed(latest_records)]
        await self.send_json({'type': 'job.snapshot', 'payload': payload})


class TaskConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.tenant_id = self.scope['url_route']['kwargs'].get('tenant_id')
        self.user = self.scope.get('user') or AnonymousUser()
        if not await self._can_access():
            await self.close(code=4403)
            return

        self.groups = [f'tasks_tenant_{self.tenant_id}']
        if self.user.is_authenticated:
            self.groups.append(f'tasks_user_{self.user.id}')

        for group in self.groups:
            await self.channel_layer.group_add(group, self.channel_name)
        await self.accept()
        await self._send_snapshot()

    async def disconnect(self, code):
        for group in getattr(self, 'groups', []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def _can_access(self) -> bool:
        user = self.user
        if not self.tenant_id:
            return False
        if not user.is_authenticated:
            return False
        if user.role == UserRole.ADMIN:
            return True
        if user.role in {UserRole.MANAGER, UserRole.REP} and str(user.tenant_id) == str(self.tenant_id):
            return True
        return False

    async def _send_snapshot(self):
        tasks = await sync_to_async(list)(
            Task.objects.filter(tenant_id=self.tenant_id)
            .select_related('client', 'created_by', 'assigned_to', 'completed_by')
            .order_by('-updated_at')[:50]
        )
        payload = [serialize_task(task) for task in tasks]
        await self.send_json({'type': 'task.snapshot', 'payload': payload})

    async def task_update(self, event: Dict[str, Any]):
        await self.send_json({'type': 'task.update', 'payload': event['payload']})

    async def task_message(self, event: Dict[str, Any]):
        await self.send_json({'type': 'task.message', 'payload': event['payload']})
