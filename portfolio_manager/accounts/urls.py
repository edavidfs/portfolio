from django.urls import path
from . import views

app_name = 'accounts'  # Optional: good practice for namespacing

urlpatterns = [
    path('', views.landing_page_view, name='landing_page'),
    path('register/', views.register_view, name='register'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('update/', views.update_account_view, name='update_account'),
    # The 'dashboard' URL used in views is not defined here yet.
    # It might be part of a different app or defined later.
]
