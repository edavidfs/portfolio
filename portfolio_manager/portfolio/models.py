from django.db import models
from django.contrib.auth.models import User

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
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    base_currency = models.CharField(max_length=3)  # e.g., "USD", "EUR"

    def __str__(self):
        return f"{self.name} ({self.user.username})"

class CurrencyHolding(models.Model):
    account = models.ForeignKey(InvestmentAccount, on_delete=models.CASCADE)
    currency = models.CharField(max_length=3)  # e.g., "USD", "EUR"
    balance = models.DecimalField(max_digits=15, decimal_places=2, default=0.00)

    class Meta:
        unique_together = ('account', 'currency')

    def __str__(self):
        return f"{self.currency} {self.balance} ({self.account.name})"

class AccountMovement(models.Model):
    MOVEMENT_TYPE_CHOICES = [
        ("DEPOSIT", "Deposit"),
        ("WITHDRAWAL", "Withdrawal"),
        ("TRANSFER_OUT", "Transfer Out"),
        ("TRANSFER_IN", "Transfer In"),
    ]
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    account = models.ForeignKey(InvestmentAccount, on_delete=models.CASCADE)
    currency_holding = models.ForeignKey(CurrencyHolding, on_delete=models.CASCADE)
    movement_type = models.CharField(max_length=12, choices=MOVEMENT_TYPE_CHOICES)  # Max length for "TRANSFER_OUT"
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    date = models.DateTimeField(auto_now_add=True)
    description = models.TextField(blank=True, null=True)
    related_movement = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True)

    def __str__(self):
        return f"{self.movement_type} of {self.amount} {self.currency_holding.currency} to {self.account.name}"
