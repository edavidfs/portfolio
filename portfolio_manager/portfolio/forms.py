from django import forms
from .models import InvestmentAccount, CurrencyHolding
from django.contrib.auth.models import User
from decimal import Decimal

class InvestmentAccountForm(forms.ModelForm):
    class Meta:
        model = InvestmentAccount
        fields = ['name', 'base_currency']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['base_currency'].help_text = "Enter a 3-letter currency code (e.g., USD, EUR)."

class CurrencyHoldingForm(forms.ModelForm):
    class Meta:
        model = CurrencyHolding
        fields = ['currency']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['currency'].help_text = "Enter a 3-letter currency code (e.g., USD, EUR)."


class DepositWithdrawForm(forms.Form):
    amount = forms.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    description = forms.CharField(widget=forms.Textarea, required=False)

class TransferFundsForm(forms.Form):
    source_holding = forms.ModelChoiceField(queryset=CurrencyHolding.objects.none(), label="From Which Currency Holding")
    destination_holding = forms.ModelChoiceField(queryset=CurrencyHolding.objects.none(), label="To Which Currency Holding")
    amount = forms.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    description = forms.CharField(widget=forms.Textarea, required=False)

    def __init__(self, *args, **kwargs):
        user = kwargs.pop('user', None)
        super().__init__(*args, **kwargs)
        if user:
            # If the user is anonymous (e.g. not logged in), user_accounts will be empty.
            # This is handled by the queryset being CurrencyHolding.objects.none() by default.
            if user.is_authenticated:
                user_accounts = InvestmentAccount.objects.filter(user=user)
                self.fields['source_holding'].queryset = CurrencyHolding.objects.filter(account__in=user_accounts)
                self.fields['destination_holding'].queryset = CurrencyHolding.objects.filter(account__in=user_accounts)
            # else, querysets remain empty, which is fine.

    def clean(self):
        cleaned_data = super().clean()
        source = cleaned_data.get('source_holding')
        destination = cleaned_data.get('destination_holding')
        amount = cleaned_data.get('amount') # Added this line

        if source and destination and source == destination:
            raise forms.ValidationError("Source and destination currency holdings cannot be the same.")

        # Check for sufficient funds only if source and amount are present
        if source and amount and source.balance < amount:
            raise forms.ValidationError("Insufficient funds in the source currency holding.")

        return cleaned_data
