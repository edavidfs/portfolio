from django.test import TestCase
from django.contrib.auth.models import User
from datetime import date as datetime_date, date # Add plain 'date' for APITests
from decimal import Decimal
import io

from django.urls import reverse # Added for APITests
from rest_framework.test import APITestCase # Added for APITests

from .models import Asset, OptionContract, Transaction, Portfolio
from .services import process_csv
from .forms import CSVUploadForm

class ModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testuser', password='password123')
        self.asset_goog = Asset.objects.create(symbol='GOOG', name='Alphabet Inc.', asset_type='stock')
        self.asset_aapl = Asset.objects.create(symbol='AAPL', name='Apple Inc.', asset_type='stock')


    def test_asset_creation(self):
        asset = Asset.objects.create(symbol='MSFT', name='Microsoft Corp.', asset_type='stock')
        self.assertEqual(asset.symbol, 'MSFT')
        self.assertEqual(asset.name, 'Microsoft Corp.')
        self.assertEqual(asset.asset_type, 'stock')
        self.assertEqual(str(asset), "Microsoft Corp. (MSFT)")

    def test_option_contract_creation(self):
        option = OptionContract.objects.create(
            underlying_asset=self.asset_goog,
            option_type='call',
            strike_price=Decimal('2800.00'),
            expiration_date=datetime_date(2024, 12, 31)
        )
        self.assertEqual(option.underlying_asset, self.asset_goog)
        self.assertEqual(option.option_type, 'call')
        self.assertEqual(option.strike_price, Decimal('2800.00'))
        self.assertEqual(option.expiration_date, datetime_date(2024, 12, 31))
        self.assertEqual(str(option), "GOOG CALL 2800.00 @ 2024-12-31")

    def test_transaction_creation(self):
        # Test stock transaction
        transaction_stock = Transaction.objects.create(
            asset=self.asset_aapl,
            transaction_type='BUY',
            date=datetime_date(2023, 10, 1),
            quantity=Decimal('100'),
            price=Decimal('150.75'),
            commission=Decimal('5.00')
        )
        self.assertEqual(transaction_stock.asset, self.asset_aapl)
        self.assertEqual(transaction_stock.transaction_type, 'BUY')
        self.assertEqual(transaction_stock.date, datetime_date(2023, 10, 1))
        self.assertEqual(transaction_stock.quantity, Decimal('100'))
        self.assertEqual(transaction_stock.price, Decimal('150.75'))
        self.assertEqual(transaction_stock.commission, Decimal('5.00'))
        self.assertEqual(str(transaction_stock), "BUY 100 AAPL on 2023-10-01")

        # Test option transaction
        option_contract = OptionContract.objects.create(
            underlying_asset=self.asset_goog,
            option_type='put',
            strike_price=Decimal('2700.00'),
            expiration_date=datetime_date(2024, 6, 21)
        )
        transaction_option = Transaction.objects.create(
            asset=self.asset_goog, # Transaction is on the underlying asset
            transaction_type='BUY_PUT',
            date=datetime_date(2023, 10, 2),
            quantity=Decimal('10'), # 10 contracts
            price=Decimal('12.50'), # Premium per contract
            commission=Decimal('2.50'),
            related_option=option_contract
        )
        self.assertEqual(transaction_option.related_option, option_contract)
        self.assertEqual(transaction_option.asset, self.asset_goog)
        self.assertEqual(str(transaction_option), "BUY_PUT 10 GOOG on 2023-10-02")
        
    def test_portfolio_creation(self):
        portfolio = Portfolio.objects.create(name='My Tech Portfolio', user=self.user)
        portfolio.assets.add(self.asset_aapl)
        portfolio.assets.add(self.asset_goog)

        self.assertEqual(portfolio.name, 'My Tech Portfolio')
        self.assertEqual(portfolio.user, self.user)
        self.assertIn(self.asset_aapl, portfolio.assets.all())
        self.assertIn(self.asset_goog, portfolio.assets.all())
        self.assertEqual(str(portfolio), "My Tech Portfolio")

        # Test get_all_transactions
        Transaction.objects.create(
            asset=self.asset_aapl, transaction_type='BUY', date=datetime_date(2023, 1, 1), 
            quantity=10, price=100
        )
        Transaction.objects.create(
            asset=self.asset_goog, transaction_type='SELL', date=datetime_date(2023, 1, 5), 
            quantity=5, price=2000
        )
        # This asset is not in the portfolio
        asset_tsla = Asset.objects.create(symbol='TSLA', name='Tesla Inc.', asset_type='stock')
        Transaction.objects.create(
            asset=asset_tsla, transaction_type='BUY', date=datetime_date(2023, 1, 10), 
            quantity=2, price=200
        )
        
        portfolio_transactions = portfolio.get_all_transactions()
        self.assertEqual(portfolio_transactions.count(), 2)
        # Check that transactions are ordered by date descending then id descending
        self.assertEqual(portfolio_transactions.first().asset, self.asset_goog)
        self.assertEqual(portfolio_transactions.last().asset, self.asset_aapl)
        for tx in portfolio_transactions:
            self.assertIn(tx.asset, portfolio.assets.all())

class CSVProcessingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='csvtestuser', password='password123')
        self.portfolio = Portfolio.objects.create(name='Test Portfolio CSV', user=self.user)

    def test_process_csv_buy_stock_valid(self):
        csv_data = (
            "Date,Type,Symbol,Quantity,Price,Commission\n"
            "2023-01-15,BUY,AAPL,10,150.00,5.00"
        )
        csv_file_obj = io.StringIO(csv_data)
        result = process_csv(csv_file_obj, portfolio_id=self.portfolio.id)

        self.assertEqual(result['status'], 'success', msg=f"Errors: {result.get('errors')}")
        self.assertEqual(result['successful_imports'], 1)
        self.assertEqual(len(result['errors']), 0)

        self.assertTrue(Asset.objects.filter(symbol='AAPL').exists())
        aapl_asset = Asset.objects.get(symbol='AAPL')
        self.assertIn(aapl_asset, self.portfolio.assets.all())
        
        self.assertTrue(Transaction.objects.filter(asset=aapl_asset, transaction_type='BUY').exists())
        transaction = Transaction.objects.get(asset=aapl_asset, transaction_type='BUY')
        self.assertEqual(transaction.date, datetime_date(2023, 1, 15))
        self.assertEqual(transaction.quantity, Decimal('10'))
        self.assertEqual(transaction.price, Decimal('150.00'))
        self.assertEqual(transaction.commission, Decimal('5.00'))

    def test_process_csv_dividend_valid(self):
        # Ensure MSFT asset exists or will be created
        Asset.objects.get_or_create(symbol='MSFT', defaults={'name': 'Microsoft Corp.', 'asset_type': 'stock'})
        csv_data = (
            "Date,Type,Symbol,Quantity,Price\n" # Assuming Quantity is number of shares for which dividend is paid, Price is total dividend
            "2023-01-20,DIVIDEND,MSFT,100,50.25" # e.g. 100 shares, total dividend $50.25
        )
        csv_file_obj = io.StringIO(csv_data)
        result = process_csv(csv_file_obj, portfolio_id=self.portfolio.id)

        self.assertEqual(result['status'], 'success', msg=f"Errors: {result.get('errors')}")
        self.assertEqual(result['successful_imports'], 1)
        self.assertEqual(len(result['errors']), 0)

        msft_asset = Asset.objects.get(symbol='MSFT')
        self.assertIn(msft_asset, self.portfolio.assets.all())
        
        self.assertTrue(Transaction.objects.filter(asset=msft_asset, transaction_type='DIVIDEND').exists())
        transaction = Transaction.objects.get(asset=msft_asset, transaction_type='DIVIDEND')
        self.assertEqual(transaction.date, datetime_date(2023, 1, 20))
        self.assertEqual(transaction.quantity, Decimal('100')) # In service.py, quantity is used as is
        self.assertEqual(transaction.price, Decimal('50.25')) # In service.py, price is used as is

    def test_process_csv_buy_call_option_valid(self):
        # Note: CSV Header in process_csv is standardized to lower_case_with_underscores.
        # My test CSV headers should match that, or the test should use the raw headers that process_csv expects.
        # process_csv standardizes: reader.fieldnames = [name.strip().lower().replace(' ', '_') for name in reader.fieldnames]
        # So, my CSV can use "Option Type" and it will become "option_type".
        csv_data = (
            "Date,Type,Symbol,Quantity,Price,Commission,Option Type,Strike Price,Expiration Date\n" 
            "2023-02-10,BUY_CALL,NVDA,2,5.50,1.00,CALL,700,2024-06-21"
        )
        csv_file_obj = io.StringIO(csv_data)
        result = process_csv(csv_file_obj, portfolio_id=self.portfolio.id)
        
        self.assertEqual(result['status'], 'success', msg=f"Errors: {result.get('errors')}")
        self.assertEqual(result['successful_imports'], 1)
        self.assertEqual(len(result['errors']), 0)

        nvda_asset = Asset.objects.get(symbol='NVDA')
        self.assertIn(nvda_asset, self.portfolio.assets.all())

        self.assertTrue(OptionContract.objects.filter(underlying_asset=nvda_asset, option_type='call').exists())
        option_contract = OptionContract.objects.get(
            underlying_asset=nvda_asset, 
            option_type='call', 
            strike_price=Decimal('700'),
            expiration_date=datetime_date(2024, 6, 21)
        )
        
        self.assertTrue(Transaction.objects.filter(asset=nvda_asset, transaction_type='BUY_CALL', related_option=option_contract).exists())
        transaction = Transaction.objects.get(asset=nvda_asset, transaction_type='BUY_CALL', related_option=option_contract)
        self.assertEqual(transaction.date, datetime_date(2023, 2, 10))
        self.assertEqual(transaction.quantity, Decimal('2')) # Number of contracts
        self.assertEqual(transaction.price, Decimal('5.50')) # Premium per contract
        self.assertEqual(transaction.commission, Decimal('1.00'))

    def test_process_csv_invalid_row_skipped(self):
        csv_data = (
            "Date,Type,Symbol,Quantity,Price\n"
            "2023-01-15,BUY,GOOD,10,150.00\n"
            "2023-01-16,,BAD,5,10.00" # Type is missing
        )
        csv_file_obj = io.StringIO(csv_data)
        result = process_csv(csv_file_obj, portfolio_id=self.portfolio.id)
        
        self.assertEqual(result['status'], 'partial_success', msg=f"Errors: {result.get('errors')}")
        self.assertEqual(result['successful_imports'], 1)
        self.assertEqual(len(result['errors']), 1)
        self.assertEqual(result['errors'][0]['row_number'], 2) # Second row (1-indexed data)
        self.assertIn("Transaction type ('Type') is missing", result['errors'][0]['error'])

        self.assertTrue(Asset.objects.filter(symbol='GOOD').exists())
        self.assertTrue(Transaction.objects.filter(asset__symbol='GOOD', transaction_type='BUY').exists())
        self.assertFalse(Asset.objects.filter(symbol='BAD').exists()) # Asset 'BAD' should not be created due to error in its row

    def test_process_csv_malformed_date(self):
        csv_data = (
            "Date,Type,Symbol,Quantity,Price\n"
            "23-01-2023,BUY,XYZ,10,50.00" # Malformed date
        )
        csv_file_obj = io.StringIO(csv_data)
        result = process_csv(csv_file_obj, portfolio_id=self.portfolio.id)

        self.assertEqual(result['status'], 'error', msg=f"Errors: {result.get('errors')}") # As only one row, and it fails
        self.assertEqual(result['successful_imports'], 0)
        self.assertEqual(len(result['errors']), 1)
        self.assertEqual(result['errors'][0]['row_number'], 1)
        self.assertIn("Date format for '23-01-2023' not recognized", result['errors'][0]['error'])
        self.assertFalse(Asset.objects.filter(symbol='XYZ').exists())

class CSVUploadFormTests(TestCase):
    def test_csv_upload_form_valid(self):
        csv_content = "Header1,Header2\nValue1,Value2"
        # For testing FileField, Django's testing tools provide SimpleUploadedFile
        from django.core.files.uploadedfile import SimpleUploadedFile
        
        # Create a SimpleUploadedFile instance
        # (name, content, content_type)
        suf = SimpleUploadedFile("test.csv", csv_content.encode('utf-8'), content_type="text/csv")
        
        file_data = {'csv_file': suf} 
        form = CSVUploadForm(data={}, files=file_data)
        
        self.assertTrue(form.is_valid(), msg=form.errors.as_json())

    def test_csv_upload_form_no_file(self):
        form = CSVUploadForm(data={}, files={}) # No file provided
        self.assertFalse(form.is_valid())
        self.assertIn('csv_file', form.errors)
        self.assertEqual(form.errors['csv_file'], ['This field is required.'])

# API Tests
class APITests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='apiuser', password='password')
        self.asset = Asset.objects.create(symbol='MSFT', name='Microsoft', asset_type='stock')
        self.portfolio = Portfolio.objects.create(name='API Test Portfolio', user=self.user)
        self.portfolio.assets.add(self.asset)

        self.transaction_stock = Transaction.objects.create(
            asset=self.asset,
            transaction_type='BUY',
            date=date(2023, 1, 1), # Using plain date here
            quantity=100,
            price=Decimal('300.00')
        )

        self.option = OptionContract.objects.create(
            underlying_asset=self.asset,
            option_type='call',
            strike_price=Decimal('350.00'),
            expiration_date=date(2024, 12, 31) # Using plain date
        )
        self.transaction_option = Transaction.objects.create(
            asset=self.asset, 
            transaction_type='BUY_CALL',
            date=date(2023, 2, 1), # Using plain date
            quantity=10,
            price=Decimal('10.00'),
            related_option=self.option
        )

    def test_list_assets_unauthenticated(self):
        url = reverse('portfolio:asset-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        # Assuming default pagination might be active or list has more than one asset from other tests
        # For a more robust test, ensure clean DB or check specific data if not paginated
        # If paginated, response.data will be a dict with 'results', 'count', etc.
        # If not paginated, response.data will be a list.
        # Let's check based on DRF's default behavior (usually paginated for ModelViewSet/ReadOnlyModelViewSet)
        if 'results' in response.data:
            self.assertTrue(len(response.data['results']) >= 1)
            asset_symbols = [item['symbol'] for item in response.data['results']]
            self.assertIn(self.asset.symbol, asset_symbols)
        else: # Not paginated
            self.assertTrue(len(response.data) >= 1)
            asset_symbols = [item['symbol'] for item in response.data]
            self.assertIn(self.asset.symbol, asset_symbols)


    def test_list_portfolios_authenticated(self):
        self.client.force_authenticate(user=self.user)
        url = reverse('portfolio:portfolio-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(len(response.data['results']) >= 1)
        
        portfolio_names = [item['name'] for item in response.data['results']]
        self.assertIn(self.portfolio.name, portfolio_names)

    def test_list_transactions_unauthenticated(self):
        url = reverse('portfolio:transaction-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(len(response.data['results']) >= 2) # We created two transactions

    def test_list_option_contracts_unauthenticated(self):
        url = reverse('portfolio:optioncontract-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(len(response.data['results']) >= 1)
        # Check if the created option's underlying asset symbol is present
        option_underlying_symbols = [item['underlying_asset_symbol'] for item in response.data['results']]
        self.assertIn(self.asset.symbol, option_underlying_symbols)

    def test_portfolio_detail_contains_transactions(self):
        self.client.force_authenticate(user=self.user)
        url = reverse('portfolio:portfolio-detail', kwargs={'pk': self.portfolio.pk})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['name'], self.portfolio.name)
        self.assertTrue('transactions' in response.data)
        self.assertTrue(len(response.data['transactions']) >= 2) # Both stock and option transactions are associated with self.asset
        
        # Check for the specific stock transaction
        found_stock_transaction = False
        for tx_data in response.data['transactions']:
            if tx_data['asset_symbol'] == self.asset.symbol and tx_data['transaction_type'] == 'BUY':
                found_stock_transaction = True
                self.assertEqual(Decimal(tx_data['price']), self.transaction_stock.price)
                break
        self.assertTrue(found_stock_transaction, "Stock transaction not found in portfolio detail.")

        # Check for the specific option transaction
        found_option_transaction = False
        for tx_data in response.data['transactions']:
             if tx_data['asset_symbol'] == self.asset.symbol and tx_data['transaction_type'] == 'BUY_CALL':
                found_option_transaction = True
                self.assertEqual(Decimal(tx_data['price']), self.transaction_option.price)
                self.assertIsNotNone(tx_data.get('related_option_str')) # Check if related_option_str is present
                break
        self.assertTrue(found_option_transaction, "Option transaction not found in portfolio detail.")
