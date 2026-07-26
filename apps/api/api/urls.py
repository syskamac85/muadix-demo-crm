"""
URL configuration for api project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from rest_framework_simplejwt.views import TokenRefreshView

from core.urls import router as core_router, urlpatterns as core_urlpatterns
from core.views import ClientViewSet
from accounts import urls as accounts_urls
from accounts.views import DemoTokenView, SecureTokenObtainPairView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/token/', SecureTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/demo-token/', DemoTokenView.as_view(), name='demo_token'),
    path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/', include(core_router.urls)),
    path('api/', include(core_urlpatterns)),
    path('api/clients/<int:pk>/call-history/', ClientViewSet.as_view({'get': 'call_history'}), name='client-call-history'),
    path('api/clients/<int:pk>/contact-plan/complete/', ClientViewSet.as_view({'post': 'mark_contact_completed'}), name='client-contact-complete'),
    path('api/accounts/', include(accounts_urls)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
