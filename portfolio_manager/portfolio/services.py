from django.contrib.auth.models import User
from .models import InvestmentAccount, CurrencyHolding, AccountMovement
from decimal import Decimal
from django.db import transaction

@transaction.atomic
def create_investment_account(user: User, name: str, base_currency: str) -> InvestmentAccount:
    """
    Creates an investment account and an initial currency holding for the base currency.
    """
    account = InvestmentAccount.objects.create(user=user, name=name, base_currency=base_currency)
    CurrencyHolding.objects.create(account=account, currency=base_currency, balance=Decimal('0.00'))
    return account

def add_currency_holding(investment_account: InvestmentAccount, currency: str) -> CurrencyHolding:
    """
    Adds a new currency holding to an existing investment account.
    Raises ValueError if the currency holding already exists.
    """
    if CurrencyHolding.objects.filter(account=investment_account, currency=currency).exists():
        raise ValueError(f"Currency holding for {currency} already exists in account {investment_account.name}")
    holding = CurrencyHolding.objects.create(account=investment_account, currency=currency, balance=Decimal('0.00'))
    return holding

@transaction.atomic
def deposit_funds(user: User, currency_holding: CurrencyHolding, amount: Decimal, description: str = None) -> AccountMovement:
    """
    Deposits funds into a currency holding and records the movement.
    """
    if amount <= Decimal('0.00'):
        raise ValueError("Deposit amount must be positive.")

    currency_holding.balance += amount
    currency_holding.save()

    movement = AccountMovement.objects.create(
        user=user,
        account=currency_holding.account,
        currency_holding=currency_holding,
        movement_type="DEPOSIT",
        amount=amount,
        description=description
    )
    return movement

@transaction.atomic
def withdraw_funds(user: User, currency_holding: CurrencyHolding, amount: Decimal, description: str = None) -> AccountMovement:
    """
    Withdraws funds from a currency holding and records the movement.
    Raises ValueError if amount is not positive or if insufficient funds.
    """
    if amount <= Decimal('0.00'):
        raise ValueError("Withdrawal amount must be positive.")
    if currency_holding.balance < amount:
        raise ValueError("Insufficient funds.")

    currency_holding.balance -= amount
    currency_holding.save()

    movement = AccountMovement.objects.create(
        user=user,
        account=currency_holding.account,
        currency_holding=currency_holding,
        movement_type="WITHDRAWAL",
        amount=amount,
        description=description
    )
    return movement

@transaction.atomic
def transfer_funds(user: User, source_holding: CurrencyHolding, destination_holding: CurrencyHolding, amount: Decimal, description: str = None) -> tuple[AccountMovement, AccountMovement]:
    """
    Transfers funds between two currency holdings of the same user and records the movements.
    Raises ValueError if amount is not positive or if insufficient funds in source.
    """
    if amount <= Decimal('0.00'):
        raise ValueError("Transfer amount must be positive.")
    if source_holding.balance < amount:
        raise ValueError("Insufficient funds in source account.")
    if source_holding.account.user != user or destination_holding.account.user != user:
        raise ValueError("User must own both source and destination accounts for the transfer.")
    # Implicit check: if source_holding.currency != destination_holding.currency, this is a cross-currency transfer.
    # The current implementation assumes direct balance transfer. For real FX, this would be more complex.

    source_holding.balance -= amount
    source_holding.save()

    destination_holding.balance += amount
    destination_holding.save()

    transfer_out_description = description or f"Transfer to {destination_holding.account.name} ({destination_holding.currency})"
    transfer_out_movement = AccountMovement.objects.create(
        user=user,
        account=source_holding.account,
        currency_holding=source_holding,
        movement_type="TRANSFER_OUT",
        amount=amount,
        description=transfer_out_description
    )

    transfer_in_description = description or f"Transfer from {source_holding.account.name} ({source_holding.currency})"
    transfer_in_movement = AccountMovement.objects.create(
        user=user,
        account=destination_holding.account,
        currency_holding=destination_holding,
        movement_type="TRANSFER_IN",
        amount=amount,
        description=transfer_in_description
    )

    transfer_out_movement.related_movement = transfer_in_movement
    transfer_out_movement.save()

    return transfer_out_movement, transfer_in_movement
