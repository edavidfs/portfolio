"""
URL configuration for portfolio_manager project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
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
from django.contrib import admin
from django.urls import path, include
from accounts import views as account_views # Import views from accounts app
from django.http import HttpResponse # For dummy view

# Dummy view for testing dashboard redirect
def dummy_dashboard_view(request):
    return HttpResponse("Mock Dashboard Page. User: " + request.user.username if request.user.is_authenticated else "Guest")

urlpatterns = [
    path('admin/', admin.site.urls),
    path('portfolio/', include('portfolio.urls')),
    path('accounts/', include('accounts.urls')), # Include accounts app URLs
    path('', account_views.landing_page_view, name='site_landing_page'), # Root URL for the site
    path('dashboard/', dummy_dashboard_view, name='dashboard'), # Dummy dashboard URL for tests
]
