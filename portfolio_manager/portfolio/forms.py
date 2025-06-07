from django import forms
from .models import InvestmentAccount, AccountTransaction
from django.core.exceptions import ValidationError

class CSVUploadForm(forms.Form):
    csv_file = forms.FileField()

class InvestmentAccountForm(forms.ModelForm):
    class Meta:
        model = InvestmentAccount
        fields = ['name', 'currency']

class DepositWithdrawForm(forms.Form):
    amount = forms.DecimalField(max_digits=15, decimal_places=2)
    description = forms.CharField(widget=forms.Textarea(attrs={'rows': 3}), required=False)
    account = forms.ModelChoiceField(queryset=InvestmentAccount.objects.none(), empty_label=None)

    def __init__(self, *args, **kwargs):
        user = kwargs.pop('user', None)
        super().__init__(*args, **kwargs)
        if user:
            self.fields['account'].queryset = InvestmentAccount.objects.filter(user=user)

class TransferForm(forms.Form):
    from_account = forms.ModelChoiceField(queryset=InvestmentAccount.objects.none(), label="From Account")
    to_account = forms.ModelChoiceField(queryset=InvestmentAccount.objects.none(), label="To Account")
    amount = forms.DecimalField(max_digits=15, decimal_places=2)
    description = forms.CharField(widget=forms.Textarea(attrs={'rows': 3}), required=False)

    def __init__(self, *args, **kwargs):
        user = kwargs.pop('user', None)
        super().__init__(*args, **kwargs)
        if user:
            user_accounts = InvestmentAccount.objects.filter(user=user)
            self.fields['from_account'].queryset = user_accounts
            self.fields['to_account'].queryset = user_accounts

    def clean(self):
        cleaned_data = super().clean()
        from_account = cleaned_data.get('from_account')
        to_account = cleaned_data.get('to_account')
        amount = cleaned_data.get('amount')

        if from_account and to_account and from_account == to_account:
            raise ValidationError("Cannot transfer to the same account.")

        if amount is not None and amount <= 0:
            raise ValidationError("Amount must be positive.")

        if from_account and amount is not None and from_account.balance < amount:
            raise ValidationError(f"Insufficient balance in {from_account.name}. Current balance: {from_account.balance}")

        return cleaned_data
