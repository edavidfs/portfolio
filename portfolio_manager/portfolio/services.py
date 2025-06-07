import csv
import io
from datetime import datetime, date, timedelta
from decimal import Decimal, InvalidOperation
import random
from django.db import transaction # For atomic operations if needed later

from .models import Asset, Transaction, OptionContract, Portfolio, InvestmentAccount, AccountTransaction

def process_csv(csv_file_obj, portfolio_id):
    """
    Processes an uploaded CSV file to import transactions and associate them with a portfolio.
    """
    rows_processed = 0
    successful_imports = 0
    failed_imports_details = []

    portfolio = None
    if portfolio_id:
        try:
            portfolio = Portfolio.objects.get(id=portfolio_id)
        except Portfolio.DoesNotExist:
            return {
                "status": "error",
                "message": f"Portfolio with id {portfolio_id} not found.",
                "rows_processed": 0,
                "successful_imports": 0,
                "errors": [{"row_number": "N/A", "error": f"Portfolio with id {portfolio_id} not found."}]
            }

    try:
        csv_file_decoded = io.TextIOWrapper(csv_file_obj, encoding='utf-8-sig') # Added -sig for potential BOM
        reader = csv.DictReader(csv_file_decoded)
        
        # Standardize column names (case-insensitive, strip spaces)
        reader.fieldnames = [name.strip().lower().replace(' ', '_') for name in reader.fieldnames]


        for i, row in enumerate(reader):
            rows_processed += 1
            row_number = i + 1 # User-friendly row number

            try:
                # Data Cleaning and Conversion
                date_str = row.get('date')
                parsed_date = None
                if date_str:
                    try:
                        parsed_date = datetime.strptime(date_str, '%Y-%m-%d').date() # Example format
                    except ValueError:
                        try:
                            parsed_date = datetime.strptime(date_str, '%m/%d/%Y').date() # Another common format
                        except ValueError:
                            raise ValueError(f"Date format for '{date_str}' not recognized. Use YYYY-MM-DD or MM/DD/YYYY.")
                else:
                    raise ValueError("Date is missing.")

                symbol = row.get('symbol', '').upper()
                if not symbol:
                    raise ValueError("Symbol is missing.")

                trans_type = row.get('type', '').upper()
                if not trans_type:
                    raise ValueError("Transaction type ('Type') is missing.")

                quantity_str = row.get('quantity', '0')
                quantity = Decimal(quantity_str)

                price_str = row.get('price', '0')
                price = Decimal(price_str)
                
                commission_str = row.get('commission')
                commission = Decimal(commission_str) if commission_str else None

                # Asset Handling
                # Assuming 'stock' for now, can be refined if CSV has asset type
                asset, asset_created = Asset.objects.get_or_create(
                    symbol=symbol,
                    defaults={'name': symbol, 'asset_type': 'stock'} 
                )
                if asset_created:
                    print(f"Created new asset: {asset}")
                
                if portfolio:
                    if asset_created or asset not in portfolio.assets.all():
                         portfolio.assets.add(asset)


                # Transaction Logic
                if trans_type in ['BUY', 'SELL']:
                    Transaction.objects.create(
                        asset=asset,
                        transaction_type=trans_type,
                        date=parsed_date,
                        quantity=quantity,
                        price=price,
                        commission=commission
                    )
                elif trans_type == 'DIVIDEND':
                    Transaction.objects.create(
                        asset=asset,
                        transaction_type='DIVIDEND',
                        date=parsed_date,
                        quantity=quantity, # CSV should specify if this is shares or 1
                        price=price, # Total dividend amount or per share
                        commission=commission
                    )
                elif trans_type in ['BUY_CALL', 'SELL_CALL', 'BUY_PUT', 'SELL_PUT']:
                    option_type_str = row.get('option_type', '').lower() # Expect 'call' or 'put'
                    strike_price_str = row.get('strike_price')
                    expiration_date_str = row.get('expiration_date')

                    if not option_type_str or not strike_price_str or not expiration_date_str:
                        raise ValueError("Missing required fields (OptionType, StrikePrice, ExpirationDate) for option transaction.")

                    strike_price = Decimal(strike_price_str)
                    
                    parsed_expiration_date = None
                    try:
                        parsed_expiration_date = datetime.strptime(expiration_date_str, '%Y-%m-%d').date()
                    except ValueError:
                        try:
                            parsed_expiration_date = datetime.strptime(expiration_date_str, '%m/%d/%Y').date()
                        except ValueError:
                             raise ValueError(f"Expiration Date format for '{expiration_date_str}' not recognized. Use YYYY-MM-DD or MM/DD/YYYY.")


                    option_contract, contract_created = OptionContract.objects.get_or_create(
                        underlying_asset=asset,
                        option_type=option_type_str,
                        strike_price=strike_price,
                        expiration_date=parsed_expiration_date,
                        # defaults={'premium': price} # 'premium' field not in model, price is in Transaction
                    )
                    if contract_created:
                        print(f"Created new option contract: {option_contract}")
                    
                    # Asset's asset_type should be 'option' if it holds options, or 'stock' if it's the underlying
                    # For now, we'll assume the primary 'asset' record is for the underlying stock.
                    # The OptionContract links to this.
                    # If the CSV can contain options as primary assets, this needs adjustment.
                    if asset.asset_type != 'stock': # Or some other underlying type
                        pass # Potentially update asset or log warning if symbol seems to be for an option itself

                    Transaction.objects.create(
                        asset=asset, # Transaction is against the underlying for options
                        transaction_type=trans_type,
                        date=parsed_date,
                        quantity=quantity, # Number of contracts
                        price=price,       # Premium per contract
                        commission=commission,
                        related_option=option_contract
                    )

                elif trans_type in ['EXPIRE_CALL', 'EXPIRE_PUT', 'ASSIGN_CALL', 'ASSIGN_PUT']:
                    print(f"Row {row_number}: Skipping unimplemented option event type: {trans_type}")
                    # For these, you'd typically find the existing OptionContract and create a transaction
                    # that reflects the expiration (quantity becomes 0, P/L realized) or assignment (stock transaction occurs).
                    # This often involves looking up the original opening transaction or the contract itself.
                    # For now, we just log and skip actual DB operation.
                    # No transaction is created here, so it won't count as successful_import for these types yet.
                    # To count it, a Transaction needs to be created, possibly with quantity/price reflecting the event.
                    failed_imports_details.append({"row_number": row_number, "data": row, "error": f"Skipping unimplemented option event type: {trans_type}"})
                    continue # Skip successful_imports increment for this row

                else:
                    raise ValueError(f"Unknown transaction type: {trans_type}")

                successful_imports += 1

            except (ValueError, InvalidOperation, KeyError, Asset.DoesNotExist, OptionContract.DoesNotExist) as e:
                failed_imports_details.append({"row_number": row_number, "data": row, "error": str(e)})
            except Exception as e: # Catch any other unexpected errors for this row
                failed_imports_details.append({"row_number": row_number, "data": row, "error": f"An unexpected error occurred: {str(e)}"})
                
    except FileNotFoundError:
         return {"status": "error", "message": "CSV file not found.", "rows_processed": 0, "successful_imports": 0, "errors": [{"row_number": "N/A", "error": "CSV file not found during processing."}]}
    except Exception as e: # Catch errors related to reading the file itself or initial setup
        return {
            "status": "error", 
            "message": f"Failed to read or process CSV: {str(e)}", 
            "rows_processed": rows_processed, 
            "successful_imports": successful_imports,
            "errors": failed_imports_details + [{"row_number": "File Level", "error": str(e)}] # Add file level error
        }

    status = "success"
    message = "CSV processing complete."
    if failed_imports_details:
        if successful_imports == 0:
            status = "error"
            message = "CSV processing failed for all rows."
        else:
            status = "partial_success"
            message = "CSV processing complete with some errors."
            
    return {
        "status": status,
        "message": message,
        "rows_processed": rows_processed,
        "successful_imports": successful_imports,
        "errors": failed_imports_details
    }

def get_account_balance_time_series(user_accounts, user_transactions):
    """
    Calculates daily balance snapshots for user accounts for Chart.js time series.
    """
    if not user_accounts.exists():
        return {
            'account_datasets': [],
            'total_dataset': {'label': 'Total Balance', 'data': [], 'borderColor': 'rgb(75, 192, 192)', 'tension': 0.1, 'fill': False},
            'labels': []
        }

    def get_random_color():
        return f"rgb({random.randint(0, 255)}, {random.randint(0, 255)}, {random.randint(0, 255)})"

    # Initialize running balances
    running_balances = {account.pk: Decimal('0.00') for account in user_accounts}
    # Initialize with current balances if available (e.g. if transactions don't start from 0)
    # For simplicity, we assume transactions reflect all changes from a zero start or that initial balances are part of transactions.
    # A more robust solution might take initial balances from InvestmentAccount.balance if transactions are partial.
    # However, the problem implies calculating from transactions.

    # Store daily snapshots: {date_obj: {account_pk: balance}}
    daily_snapshots = {}
    all_dates = set()

    if not user_transactions.exists():
        # If no transactions, create a single snapshot for today with current balances
        # (assuming current balances are accurate if no transactions are recorded by this system)
        # or zeros if we strictly build from transactions.
        # For this function, if no transactions, it implies all accounts are at 0 based on transaction history.
        today = date.today()
        snapshot = {acc.pk: Decimal('0.00') for acc in user_accounts} # Or acc.balance if we use that as starting point
        daily_snapshots[today] = snapshot.copy()
        all_dates.add(today)
    else:
        # Group transactions by date
        transactions_by_date = {}
        for t in user_transactions.order_by('date', 'pk'): # Ensure consistent order
            # 'date' field in AccountTransaction is DateTimeField, convert to date object for key
            transaction_date = t.date.date()
            if transaction_date not in transactions_by_date:
                transactions_by_date[transaction_date] = []
            transactions_by_date[transaction_date].append(t)

        sorted_transaction_dates = sorted(transactions_by_date.keys())

        if not sorted_transaction_dates: # Should not happen if user_transactions.exists() is true
             today = date.today()
             snapshot = {acc.pk: Decimal('0.00') for acc in user_accounts}
             daily_snapshots[today] = snapshot.copy()
             all_dates.add(today)

        else:
            first_transaction_date = sorted_transaction_dates[0]
            # Fill from start_date (e.g. 30 days before first transaction or fixed window) up to first transaction date
            # For simplicity, we start from the first transaction date.
            # If there's a need to show 0 balances before, this range would need adjustment.

            current_date = first_transaction_date
            last_processed_date = None

            for trans_date in sorted_transaction_dates:
                # Fill in days between last transaction date and current transaction date
                if last_processed_date:
                    days_diff = (trans_date - last_processed_date).days
                    for i in range(1, days_diff):
                        intermediate_date = last_processed_date + timedelta(days=i)
                        if intermediate_date not in daily_snapshots: # Avoid re-adding if already processed by another logic
                            daily_snapshots[intermediate_date] = running_balances.copy()
                            all_dates.add(intermediate_date)

                # Process transactions for trans_date
                for t in transactions_by_date[trans_date]:
                    if t.from_account_id and t.from_account_id in running_balances:
                        running_balances[t.from_account_id] -= t.amount
                    if t.to_account_id and t.to_account_id in running_balances:
                        running_balances[t.to_account_id] += t.amount

                daily_snapshots[trans_date] = running_balances.copy()
                all_dates.add(trans_date)
                last_processed_date = trans_date

            # Fill from last transaction date to today
            if last_processed_date:
                today = date.today()
                days_diff_to_today = (today - last_processed_date).days
                for i in range(1, days_diff_to_today + 1): # Include today
                    intermediate_date = last_processed_date + timedelta(days=i)
                    if intermediate_date not in daily_snapshots:
                         daily_snapshots[intermediate_date] = running_balances.copy()
                         all_dates.add(intermediate_date)

            # If all_dates is still empty (e.g. only future transactions), add today
            if not all_dates and last_processed_date is None:
                 today = date.today()
                 snapshot = {acc.pk: Decimal('0.00') for acc in user_accounts}
                 daily_snapshots[today] = snapshot.copy()
                 all_dates.add(today)


    # Prepare for Chart.js
    sorted_all_dates = sorted(list(all_dates))
    labels = [d.strftime('%Y-%m-%d') for d in sorted_all_dates]

    account_datasets = []
    account_map = {account.pk: account for account in user_accounts}

    for account_pk, account_obj in account_map.items():
        data_points = []
        for d in sorted_all_dates:
            balance = daily_snapshots.get(d, {}).get(account_pk, Decimal('0.00'))
            data_points.append({'x': d.strftime('%Y-%m-%d'), 'y': balance})

        account_datasets.append({
            'label': account_obj.name,
            'data': data_points,
            'borderColor': get_random_color(),
            'tension': 0.1,
            'fill': False
        })

    total_data_points = []
    for d in sorted_all_dates:
        total_balance_on_day = sum(daily_snapshots.get(d, {}).get(acc_pk, Decimal('0.00')) for acc_pk in account_map.keys())
        total_data_points.append({'x': d.strftime('%Y-%m-%d'), 'y': total_balance_on_day})

    total_dataset = {
        'label': 'Total Balance',
        'data': total_data_points,
        'borderColor': get_random_color(), # Or a fixed color like 'rgb(75, 192, 192)'
        'tension': 0.1,
        'fill': False
    }

    # Ensure there is at least one label if dates were generated
    if not labels and sorted_all_dates:
        labels = [sorted_all_dates[0].strftime('%Y-%m-%d')]


    return {
        'account_datasets': account_datasets,
        'total_dataset': total_dataset,
        'labels': labels
    }
