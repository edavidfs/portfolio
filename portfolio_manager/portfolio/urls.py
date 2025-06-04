from django.urls import path, include # Import include
from rest_framework.routers import DefaultRouter
from . import views # Keep this for upload_csv_view
from .views import AssetViewSet, OptionContractViewSet, TransactionViewSet, PortfolioViewSet # Import ViewSets

app_name = 'portfolio'

router = DefaultRouter()
router.register(r'assets', AssetViewSet, basename='asset')
router.register(r'optioncontracts', OptionContractViewSet, basename='optioncontract')
router.register(r'transactions', TransactionViewSet, basename='transaction')
router.register(r'portfolios', PortfolioViewSet, basename='portfolio')

urlpatterns = [
    path('upload-csv/', views.upload_csv_view, name='upload_csv'), # Keep existing CSV upload
    path('api/', include(router.urls)), # Add DRF URLs under 'api/' prefix within the app
]
