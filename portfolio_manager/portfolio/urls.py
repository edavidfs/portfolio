from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views # General views like upload_csv_view, dashboard_placeholder_view
from .views import (
    AssetViewSet, OptionContractViewSet, TransactionViewSet, PortfolioViewSet, # DRF ViewSets
    InvestmentAccountListView, InvestmentAccountCreateView, InvestmentAccountDetailView, # Investment Account CBVs
    DepositView, WithdrawView, TransferView # Transaction CBVs
)

app_name = 'portfolio'

router = DefaultRouter()
router.register(r'assets', AssetViewSet, basename='asset')
router.register(r'optioncontracts', OptionContractViewSet, basename='optioncontract')
router.register(r'transactions', TransactionViewSet, basename='transaction')
router.register(r'portfolios', PortfolioViewSet, basename='portfolio')

urlpatterns = [
    path('upload-csv/', views.upload_csv_view, name='upload_csv'),
    path('dashboard/', views.dashboard_placeholder_view, name='dashboard'),

    # Investment Accounts
    path('accounts/', InvestmentAccountListView.as_view(), name='investmentaccount_list'),
    path('accounts/create/', InvestmentAccountCreateView.as_view(), name='investmentaccount_create'),
    path('accounts/<int:pk>/', InvestmentAccountDetailView.as_view(), name='investmentaccount_detail'),

    # Transactions for Investment Accounts
    path('accounts/deposit/', DepositView.as_view(), name='deposit_funds'), # Changed name for clarity
    path('accounts/withdraw/', WithdrawView.as_view(), name='withdraw_funds'), # Changed name for clarity
    path('accounts/transfer/', TransferView.as_view(), name='transfer_funds'), # Changed name for clarity

    # API routes
    path('api/', include(router.urls)),
]
