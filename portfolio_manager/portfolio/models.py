from django.db import models
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError

class Asset(models.Model):
    ASSET_TYPE_CHOICES = [
        ('stock', 'Stock'),
        ('option', 'Option'),
    ]
    symbol = models.CharField(max_length=10, unique=True)
    name = models.CharField(max_length=100)
    asset_type = models.CharField(max_length=10, choices=ASSET_TYPE_CHOICES)

    def __str__(self):
        return f"{self.name} ({self.symbol})"

class OptionContract(models.Model):
    OPTION_TYPE_CHOICES = [
        ('call', 'Call'),
        ('put', 'Put'),
    ]
    underlying_asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name='options')
    option_type = models.CharField(max_length=4, choices=OPTION_TYPE_CHOICES)
    strike_price = models.DecimalField(max_digits=10, decimal_places=2)
    expiration_date = models.DateField()

    def __str__(self):
        return f"{self.underlying_asset.symbol} {self.option_type.upper()} {self.strike_price} @ {self.expiration_date}"

class Transaction(models.Model):
    TRANSACTION_TYPES = [
        ('BUY', 'Buy Stock'),
        ('SELL', 'Sell Stock'),
        ('DIVIDEND', 'Dividend'),
        ('BUY_CALL', 'Buy Call Option'),
        ('SELL_CALL', 'Sell Call Option (Write)'),
        ('BUY_PUT', 'Buy Put Option'),
        ('SELL_PUT', 'Sell Put Option (Write)'),
        ('EXPIRE_CALL', 'Call Option Expired'),
        ('EXPIRE_PUT', 'Put Option Expired'),
        ('ASSIGN_CALL', 'Call Option Assigned'),
        ('ASSIGN_PUT', 'Put Option Assigned'),
    ]
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name='transactions')
    transaction_type = models.CharField(max_length=15, choices=TRANSACTION_TYPES) # Updated max_length and choices
    date = models.DateField()
    quantity = models.DecimalField(max_digits=10, decimal_places=4)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    commission = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    related_option = models.ForeignKey(OptionContract, on_delete=models.SET_NULL, null=True, blank=True, related_name='trades')

    def __str__(self):
        return f"{self.transaction_type.upper()} {self.quantity} {self.asset.symbol} on {self.date}"

class Portfolio(models.Model):
    name = models.CharField(max_length=100, unique=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='portfolios', null=True, blank=True)
    assets = models.ManyToManyField(Asset, related_name='portfolios', blank=True)

    def __str__(self):
        return self.name

    def get_all_transactions(self):
        # Returns all transactions for all assets in this portfolio
        # Ensure Transaction model is accessible here (it is, as it's in the same file)
        return Transaction.objects.filter(asset__in=self.assets.all()).order_by('-date', '-id')

class InvestmentAccount(models.Model):
    name = models.CharField(max_length=100)
    currency = models.CharField(max_length=3)  # e.g., USD, EUR
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='investment_accounts')
    balance = models.DecimalField(max_digits=15, decimal_places=2, default=0.00)

    def __str__(self):
        return f"{self.name} ({self.user.username})"

class AccountTransaction(models.Model):
    TRANSACTION_TYPE_CHOICES = [
        ('deposit', 'Deposit'),
        ('withdraw', 'Withdraw'),
        ('transfer', 'Transfer'),
    ]
    from_account = models.ForeignKey(InvestmentAccount, on_delete=models.CASCADE, null=True, blank=True, related_name='outgoing_transactions')
    to_account = models.ForeignKey(InvestmentAccount, on_delete=models.CASCADE, null=True, blank=True, related_name='incoming_transactions')
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    transaction_type = models.CharField(max_length=10, choices=TRANSACTION_TYPE_CHOICES)
    date = models.DateTimeField(auto_now_add=True)
    description = models.CharField(max_length=255, blank=True, null=True)

    def __str__(self):
        if self.transaction_type == 'deposit':
            return f"Deposit of {self.amount} to {self.to_account.name}"
        elif self.transaction_type == 'withdraw':
            return f"Withdrawal of {self.amount} from {self.from_account.name}"
        elif self.transaction_type == 'transfer':
            return f"Transfer of {self.amount} from {self.from_account.name} to {self.to_account.name}"
        return "Transaction"

    def clean(self):
        if self.amount <= 0:
            raise ValidationError("Amount must be positive.")
        if self.transaction_type == 'deposit':
            if self.from_account is not None:
                raise ValidationError("Deposit transaction cannot have a from_account.")
            if self.to_account is None:
                raise ValidationError("Deposit transaction must have a to_account.")
        elif self.transaction_type == 'withdraw':
            if self.to_account is not None:
                raise ValidationError("Withdrawal transaction cannot have a to_account.")
            if self.from_account is None:
                raise ValidationError("Withdrawal transaction must have a from_account.")
        elif self.transaction_type == 'transfer':
            if self.from_account is None or self.to_account is None:
                raise ValidationError("Transfer transaction must have both from_account and to_account.")
            if self.from_account == self.to_account:
                raise ValidationError("Cannot transfer to the same account.")
