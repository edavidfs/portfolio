from django.shortcuts import render
from django.http import HttpResponse, JsonResponse
from django.urls import reverse_lazy
from django.views.generic import ListView, CreateView, DetailView
from django.contrib.auth.mixins import LoginRequiredMixin
from django.db.models import Q
from django.db import transaction
from django.contrib import messages
from django.shortcuts import get_object_or_404 # redirect is usually handled by CreateView's success_url

from rest_framework import viewsets
# from rest_framework import permissions # Will add later if needed

from .forms import CSVUploadForm, InvestmentAccountForm, DepositWithdrawForm, TransferForm
from .services import process_csv
from .models import Asset, OptionContract, Transaction, Portfolio, InvestmentAccount, AccountTransaction
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

@login_required
def dashboard_placeholder_view(request):
    return render(request, 'portfolio/dashboard_placeholder.html')


# Investment Account Views

class InvestmentAccountListView(LoginRequiredMixin, ListView):
    model = InvestmentAccount
    template_name = 'portfolio/investmentaccount_list.html'
    context_object_name = 'accounts'

    def get_queryset(self):
        return InvestmentAccount.objects.filter(user=self.request.user)

class InvestmentAccountCreateView(LoginRequiredMixin, CreateView):
    model = InvestmentAccount
    form_class = InvestmentAccountForm
    template_name = 'portfolio/investmentaccount_form.html'
    success_url = reverse_lazy('portfolio:investmentaccount_list') # Adjust 'portfolio:investmentaccount_list' as needed

    def form_valid(self, form):
        form.instance.user = self.request.user
        return super().form_valid(form)

class InvestmentAccountDetailView(LoginRequiredMixin, DetailView):
    model = InvestmentAccount
    template_name = 'portfolio/investmentaccount_detail.html'
    context_object_name = 'account'

    def get_queryset(self):
        return InvestmentAccount.objects.filter(user=self.request.user)

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        # Ensure self.object is the InvestmentAccount instance
        if self.object:
            context['transactions'] = AccountTransaction.objects.filter(
                Q(from_account=self.object) | Q(to_account=self.object)
            ).distinct().order_by('-date')
        else:
            context['transactions'] = AccountTransaction.objects.none()
        return context


# Account Transaction Views

class DepositView(LoginRequiredMixin, CreateView):
    form_class = DepositWithdrawForm
    template_name = 'portfolio/deposit_form.html' # Create this template
    success_url = reverse_lazy('portfolio:investmentaccount_list')

    def get_form_kwargs(self):
        kwargs = super().get_form_kwargs()
        kwargs['user'] = self.request.user
        return kwargs

    def form_valid(self, form):
        account = form.cleaned_data['account']
        amount = form.cleaned_data['amount']
        description = form.cleaned_data['description']

        # Double check ownership, though form queryset should handle this
        if account.user != self.request.user:
            messages.error(self.request, "You do not have permission to transact on this account.")
            return self.form_invalid(form)

        with transaction.atomic():
            AccountTransaction.objects.create(
                to_account=account,
                amount=amount,
                transaction_type='deposit',
                description=description
            )
            account.balance += amount
            account.save()

        messages.success(self.request, f"Successfully deposited {amount} into {account.name}.")
        return super().form_valid(form)

class WithdrawView(LoginRequiredMixin, CreateView):
    form_class = DepositWithdrawForm
    template_name = 'portfolio/withdraw_form.html' # Create this template
    success_url = reverse_lazy('portfolio:investmentaccount_list')

    def get_form_kwargs(self):
        kwargs = super().get_form_kwargs()
        kwargs['user'] = self.request.user
        return kwargs

    def form_valid(self, form):
        account = form.cleaned_data['account']
        amount = form.cleaned_data['amount']
        description = form.cleaned_data['description']

        if account.user != self.request.user:
            messages.error(self.request, "You do not have permission to transact on this account.")
            return self.form_invalid(form)

        if account.balance < amount:
            form.add_error('amount', f"Insufficient balance. Current balance: {account.balance}")
            return self.form_invalid(form)

        with transaction.atomic():
            AccountTransaction.objects.create(
                from_account=account,
                amount=amount,
                transaction_type='withdraw',
                description=description
            )
            account.balance -= amount
            account.save()

        messages.success(self.request, f"Successfully withdrew {amount} from {account.name}.")
        return super().form_valid(form)

class TransferView(LoginRequiredMixin, CreateView):
    form_class = TransferForm
    template_name = 'portfolio/transfer_form.html' # Create this template
    success_url = reverse_lazy('portfolio:investmentaccount_list')

    def get_form_kwargs(self):
        kwargs = super().get_form_kwargs()
        kwargs['user'] = self.request.user
        return kwargs

    def form_valid(self, form):
        from_account = form.cleaned_data['from_account']
        to_account = form.cleaned_data['to_account']
        amount = form.cleaned_data['amount']
        description = form.cleaned_data['description']

        # Form's clean method already validates ownership via queryset and insufficient balance.
        # An additional check here is defense in depth.
        if from_account.user != self.request.user or to_account.user != self.request.user:
            messages.error(self.request, "You do not have permission to transact with one or both of these accounts.")
            return self.form_invalid(form)

        # This check is also in form's clean method, but good for server-side robustness.
        if from_account.balance < amount:
            form.add_error('amount', f"Insufficient balance in {from_account.name}. Current balance: {from_account.balance}")
            return self.form_invalid(form)

        if from_account == to_account: # Should be caught by form's clean method
            form.add_error(None, "Cannot transfer to the same account.")
            return self.form_invalid(form)

        with transaction.atomic():
            AccountTransaction.objects.create(
                from_account=from_account,
                to_account=to_account,
                amount=amount,
                transaction_type='transfer',
                description=description
            )
            from_account.balance -= amount
            from_account.save()
            to_account.balance += amount
            to_account.save()

        messages.success(self.request, f"Successfully transferred {amount} from {from_account.name} to {to_account.name}.")
        return super().form_valid(form)
