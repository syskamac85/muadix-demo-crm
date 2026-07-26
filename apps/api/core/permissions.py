from rest_framework.permissions import BasePermission

from accounts.models import UserRole


class IsManagerOrAdmin(BasePermission):
    """
    Allows access only to authenticated users with manager or admin role.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return user.role in {UserRole.ADMIN, UserRole.MANAGER}
