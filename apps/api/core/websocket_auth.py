from __future__ import annotations

from typing import Optional
from urllib.parse import parse_qs

from asgiref.sync import sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken


class JWTAuthMiddleware:
    """
    Minimal JWT middleware for WebSocket connections.
    Expects token in the query string (?token=<JWT>).
    """

    def __init__(self, inner):
        self.inner = inner
        self.jwt_auth = JWTAuthentication()

    async def __call__(self, scope, receive, send):
        scope['user'] = scope.get('user') or AnonymousUser()
        token = self._extract_token(scope)
        if token:
            user = await sync_to_async(self._authenticate_token)(token)
            scope['user'] = user or AnonymousUser()
        return await self.inner(scope, receive, send)

    def _extract_token(self, scope) -> Optional[str]:
        query_string = scope.get('query_string', b'').decode()
        params = parse_qs(query_string)
        token = params.get('token', [None])[0]
        if token:
            return token
        return None

    def _authenticate_token(self, token: str):
        try:
            validated = self.jwt_auth.get_validated_token(token)
            return self.jwt_auth.get_user(validated)
        except (InvalidToken, AuthenticationFailed):
            return None
