from django.urls import path, include # Import include
from rest_framework.routers import DefaultRouter
from . import views # Keep this for upload_csv_view
from .views import (
    AssetViewSet, OptionContractViewSet, TransactionViewSet, PortfolioViewSet, # Existing ViewSets
    InvestmentAccountListView, InvestmentAccountDetailView, InvestmentAccountCreateView,
    add_currency_holding_view, deposit_funds_view, withdraw_funds_view, TransferFundsView,
    dashboard_placeholder_view, get_fund_evolution_data_view # Added get_fund_evolution_data_view
)

app_name = 'portfolio'

router = DefaultRouter()
router.register(r'assets', AssetViewSet, basename='asset')
router.register(r'optioncontracts', OptionContractViewSet, basename='optioncontract')
router.register(r'transactions', TransactionViewSet, basename='transaction')
router.register(r'portfolios', PortfolioViewSet, basename='portfolio')

urlpatterns = [
    path('upload-csv/', views.upload_csv_view, name='upload_csv'), # Keep existing CSV upload
    path('dashboard/', views.dashboard_placeholder_view, name='dashboard'), # Existing dashboard placeholder
    path('api/', include(router.urls)), # Add DRF URLs under 'api/' prefix within the app

    # Investment Account URLs
    path('investment-accounts/', views.InvestmentAccountListView.as_view(), name='investmentaccount_list'),
    path('investment-accounts/create/', views.InvestmentAccountCreateView.as_view(), name='investmentaccount_create'),
    path('investment-accounts/<int:pk>/', views.InvestmentAccountDetailView.as_view(), name='investmentaccount_detail'),
    path('investment-accounts/<int:account_pk>/add-currency/', views.add_currency_holding_view, name='add_currency_holding'),

    path('currency-holding/<int:holding_pk>/deposit/', views.deposit_funds_view, name='deposit_funds'),
    path('currency-holding/<int:holding_pk>/withdraw/', views.withdraw_funds_view, name='withdraw_funds'),

    path('transfer-funds/', views.TransferFundsView.as_view(), name='transfer_funds'),

    # API Endpoints
    path('api/fund-evolution-data/', views.get_fund_evolution_data_view, name='fund_evolution_data_api'),
]
