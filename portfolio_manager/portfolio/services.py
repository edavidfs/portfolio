import csv
import io
from datetime import datetime
from decimal import Decimal, InvalidOperation # Added InvalidOperation
from django.db import transaction # For atomic operations if needed later

from .models import Asset, Transaction, OptionContract, Portfolio # Added Portfolio

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
