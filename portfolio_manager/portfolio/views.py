from django.shortcuts import render
from django.http import HttpResponse, JsonResponse # Added JsonResponse for structured response
from rest_framework import viewsets
# from rest_framework import permissions # Will add later if needed

from .forms import CSVUploadForm
from .services import process_csv # Import process_csv
from .models import Asset, OptionContract, Transaction, Portfolio
from .serializers import AssetSerializer, OptionContractSerializer, TransactionSerializer, PortfolioSerializer


# Existing CSV upload view
def upload_csv_view(request):
    if request.method == 'POST':
        form = CSVUploadForm(request.POST, request.FILES)
        if form.is_valid():
            csv_file = request.FILES['csv_file']
            # For now, portfolio_id is None. This will be updated later.
            # Assuming process_csv is intended to be used by an authenticated user for their portfolio
            # This view might need user context if portfolio_id is tied to request.user
            result = process_csv(csv_file, portfolio_id=None) 
            return JsonResponse(result) # Return the result from process_csv
        else:
            # If form is not valid, re-render the template with the form (containing errors)
            # and potentially an error message.
            return render(request, 'portfolio/upload_csv.html', {'form': form, 'errors': form.errors})
    else:
        form = CSVUploadForm()
    return render(request, 'portfolio/upload_csv.html', {'form': form})


# DRF ViewSets

class AssetViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint that allows assets to be viewed.
    """
    queryset = Asset.objects.all()
    serializer_class = AssetSerializer

class OptionContractViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint that allows option contracts to be viewed.
    """
    queryset = OptionContract.objects.all()
    serializer_class = OptionContractSerializer

class TransactionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint that allows transactions to be viewed.
    """
    queryset = Transaction.objects.all().order_by('-date', '-id')
    serializer_class = TransactionSerializer

class PortfolioViewSet(viewsets.ModelViewSet): # Changed to ModelViewSet for future CRUD
    """
    API endpoint that allows portfolios to be viewed and managed.
    """
    queryset = Portfolio.objects.all()
    serializer_class = PortfolioSerializer
    # permission_classes = [permissions.IsAuthenticatedOrReadOnly] # Optional for now

from django.contrib.auth.decorators import login_required
from django.views.generic import ListView, DetailView, CreateView, View
from django.contrib.auth.mixins import LoginRequiredMixin
from django.urls import reverse_lazy, reverse
from django.contrib import messages
from django.shortcuts import redirect, get_object_or_404 # render is already imported
from decimal import Decimal

from .models import InvestmentAccount, CurrencyHolding, AccountMovement # Asset, OptionContract, Transaction, Portfolio already imported
from .forms import InvestmentAccountForm, CurrencyHoldingForm, DepositWithdrawForm, TransferFundsForm # CSVUploadForm already imported
from .services import create_investment_account, add_currency_holding, deposit_funds, withdraw_funds, transfer_funds # process_csv already imported


@login_required
def dashboard_placeholder_view(request):
    return render(request, 'portfolio/dashboard_placeholder.html')

# Investment Account Management Views

class InvestmentAccountListView(LoginRequiredMixin, ListView):
    model = InvestmentAccount
    template_name = 'portfolio/investmentaccount_list.html'
    context_object_name = 'accounts'

    def get_queryset(self):
        return InvestmentAccount.objects.filter(user=self.request.user).order_by('name')

class InvestmentAccountDetailView(LoginRequiredMixin, DetailView):
    model = InvestmentAccount
    template_name = 'portfolio/investmentaccount_detail.html'
    context_object_name = 'account'

    def get_queryset(self):
        return InvestmentAccount.objects.filter(user=self.request.user)

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        account = self.get_object()
        context['currency_holdings'] = CurrencyHolding.objects.filter(account=account).order_by('currency')
        context['movements'] = AccountMovement.objects.filter(account=account).order_by('-date')
        context['currency_holding_form'] = CurrencyHoldingForm()
        # For deposit/withdraw, it's better to pass the form for a specific holding if that's how templates are structured
        # However, providing generic forms here is also fine if templates handle selection of holding.
        # For simplicity with the current plan, generic forms are added.
        # These could also be instantiated per holding in the template if needed, or handled by separate views more directly.
        context['deposit_form'] = DepositWithdrawForm()
        context['withdraw_form'] = DepositWithdrawForm()
        return context

class InvestmentAccountCreateView(LoginRequiredMixin, CreateView):
    model = InvestmentAccount
    form_class = InvestmentAccountForm
    template_name = 'portfolio/investmentaccount_form.html'
    # Assuming 'portfolio:investmentaccount_list' is the correct name for your URL pattern
    success_url = reverse_lazy('portfolio:investmentaccount_list')

    def form_valid(self, form):
        # self.request.user is already available
        try:
            # The service function create_investment_account already sets the user
            self.object = create_investment_account(
                user=self.request.user,
                name=form.cleaned_data['name'],
                base_currency=form.cleaned_data['base_currency']
            )
            messages.success(self.request, "Investment account created successfully.")
            # No need to call super().form_valid() if service function handles object creation
            return redirect(self.get_success_url())
        except Exception as e:
            messages.error(self.request, f"Error creating account: {e}")
            return self.form_invalid(form)

@login_required
def add_currency_holding_view(request, account_pk):
    account = get_object_or_404(InvestmentAccount, pk=account_pk, user=request.user)
    if request.method == 'POST':
        form = CurrencyHoldingForm(request.POST)
        if form.is_valid():
            try:
                add_currency_holding(investment_account=account, currency=form.cleaned_data['currency'])
                messages.success(request, f"Currency holding for {form.cleaned_data['currency']} added successfully.")
            except ValueError as e:
                messages.error(request, str(e))
        else:
            # Collect form errors and display them
            error_message = "Failed to add currency holding. " + " ".join([f"{field}: {', '.join(errors)}" for field, errors in form.errors.items()])
            messages.error(request, error_message)
        # Assuming 'portfolio:investmentaccount_detail' is the correct name
        return redirect(reverse('portfolio:investmentaccount_detail', kwargs={'pk': account.pk}))
    else:
        messages.error(request, "Invalid request method for adding currency holding.")
         # Fallback redirect if not POST, though typically this view would only be accessed via POST from a form
        return redirect(reverse('portfolio:investmentaccount_detail', kwargs={'pk': account.pk}))


@login_required
def deposit_funds_view(request, holding_pk):
    holding = get_object_or_404(CurrencyHolding, pk=holding_pk, account__user=request.user)
    if request.method == 'POST':
        form = DepositWithdrawForm(request.POST)
        if form.is_valid():
            amount = form.cleaned_data['amount']
            description = form.cleaned_data['description']
            try:
                deposit_funds(user=request.user, currency_holding=holding, amount=amount, description=description)
                messages.success(request, f"Successfully deposited {amount} {holding.currency}.")
            except ValueError as e:
                messages.error(request, str(e))
        else:
            error_message = "Failed to deposit funds. " + " ".join([f"{field}: {', '.join(errors)}" for field, errors in form.errors.items()])
            messages.error(request, error_message)
        return redirect(reverse('portfolio:investmentaccount_detail', kwargs={'pk': holding.account.pk}))
    else:
        messages.error(request, "Invalid request method for deposit.")
        return redirect(reverse('portfolio:investmentaccount_detail', kwargs={'pk': holding.account.pk}))


@login_required
def withdraw_funds_view(request, holding_pk):
    holding = get_object_or_404(CurrencyHolding, pk=holding_pk, account__user=request.user)
    if request.method == 'POST':
        form = DepositWithdrawForm(request.POST)
        if form.is_valid():
            amount = form.cleaned_data['amount']
            description = form.cleaned_data['description']
            try:
                withdraw_funds(user=request.user, currency_holding=holding, amount=amount, description=description)
                messages.success(request, f"Successfully withdrew {amount} {holding.currency}.")
            except ValueError as e:
                messages.error(request, str(e))
        else:
            error_message = "Failed to withdraw funds. " + " ".join([f"{field}: {', '.join(errors)}" for field, errors in form.errors.items()])
            messages.error(request, error_message)
        return redirect(reverse('portfolio:investmentaccount_detail', kwargs={'pk': holding.account.pk}))
    else:
        messages.error(request, "Invalid request method for withdrawal.")
        return redirect(reverse('portfolio:investmentaccount_detail', kwargs={'pk': holding.account.pk}))


class TransferFundsView(LoginRequiredMixin, View):
    template_name = 'portfolio/transfer_funds_form.html'

    def get(self, request, *args, **kwargs):
        form = TransferFundsForm(user=request.user)
        return render(request, self.template_name, {'form': form})

    def post(self, request, *args, **kwargs):
        form = TransferFundsForm(request.POST, user=request.user)
        if form.is_valid():
            source_holding = form.cleaned_data['source_holding']
            destination_holding = form.cleaned_data['destination_holding']
            amount = form.cleaned_data['amount']
            description = form.cleaned_data['description']
            try:
                transfer_funds(
                    user=request.user,
                    source_holding=source_holding,
                    destination_holding=destination_holding,
                    amount=amount,
                    description=description
                )
                messages.success(request, "Funds transferred successfully.")
                # Consider redirecting to the detail of source or destination account, or list view
                return redirect(reverse('portfolio:investmentaccount_list'))
            except ValueError as e:
                messages.error(request, str(e))
                # Fall through to render form with this error if service layer raises ValueError

        # If form is invalid (either from initial check or from service layer error re-populating)
        return render(request, self.template_name, {'form': form})

# Dashboard Chart Data API
from django.http import JsonResponse # Already imported via HttpResponse, JsonResponse earlier, but good to be explicit if that changes
from collections import defaultdict
from datetime import timedelta, date # datetime was already imported
# Decimal is already imported
from django.db.models import Sum, F, Window, Q, Case, When, DecimalField
from django.db.models.functions import TruncDate
# User model is already imported

@login_required
def get_fund_evolution_data_view(request):
    user = request.user

    # Get all investment accounts for the user to filter movements by these accounts
    user_investment_accounts = InvestmentAccount.objects.filter(user=user)

    movements = AccountMovement.objects.filter(account__in=user_investment_accounts).order_by('date')

    # We need to calculate a running total based on movements.
    # This chart will show the net change in value across all currencies by summing movements.
    # A more advanced chart would convert all values to a single base currency.

    # Group movements by date and calculate the net change for each day.
    daily_net_movements = movements.annotate(movement_date=TruncDate('date')) \
                                   .values('movement_date') \
                                   .annotate(net_change=Sum(
                                       Case(
                                           When(movement_type__in=['DEPOSIT', 'TRANSFER_IN'], then=F('amount')),
                                           When(movement_type__in=['WITHDRAWAL', 'TRANSFER_OUT'], then=-F('amount')),
                                           default=Decimal('0.0'),
                                           output_field=DecimalField(max_digits=15, decimal_places=2)
                                       )
                                   )) \
                                   .order_by('movement_date')

    labels = []
    data_points = []
    running_total = Decimal('0.0')

    if daily_net_movements.exists():
        # Ensure first_movement_date and last_movement_date are date objects
        first_movement_entry = daily_net_movements.first()
        last_movement_entry = daily_net_movements.last()

        # Handle cases where movement_date might be None if TruncDate results in None (though unlikely for valid dates)
        first_movement_date = first_movement_entry['movement_date'] if first_movement_entry and first_movement_entry['movement_date'] else date.today()
        last_movement_date = last_movement_entry['movement_date'] if last_movement_entry and last_movement_entry['movement_date'] else date.today()


        # Create a map of dates to net changes for quick lookup
        movements_map = {item['movement_date']: item['net_change'] for item in daily_net_movements if item['movement_date']}

        current_date = first_movement_date
        while current_date <= last_movement_date:
            running_total += movements_map.get(current_date, Decimal('0.0'))
            labels.append(current_date.strftime('%Y-%m-%d'))
            # Ensure data_points stores strings that can be parsed by JS, or numbers directly if JSON handles Decimals.
            # Standard json library doesn't handle Decimals, Django's JsonResponse might.
            # For safety, convert to float or string here. Chart.js needs numbers.
            data_points.append(float(running_total))
            current_date += timedelta(days=1)

    if not labels: # If no movements, or if date range was invalid
        labels.append(date.today().strftime('%Y-%m-%d'))
        data_points.append(0.0) # Use float for consistency

    chart_data = {
        'labels': labels,
        'datasets': [{
            'label': 'Net Portfolio Value (Sum of Movements)', # Updated label
            'data': data_points,
            'borderColor': 'rgb(75, 192, 192)',
            'tension': 0.1
        }]
    }
    return JsonResponse(chart_data)
