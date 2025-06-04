from rest_framework import serializers
from .models import Asset, OptionContract, Transaction, Portfolio

class AssetSerializer(serializers.ModelSerializer): # Changed to ModelSerializer
    url = serializers.HyperlinkedIdentityField(view_name='asset-detail') # Added for hyperlinking

    class Meta:
        model = Asset
        fields = ['id', 'url', 'symbol', 'name', 'asset_type']

class OptionContractSerializer(serializers.ModelSerializer): # Changed to ModelSerializer
    url = serializers.HyperlinkedIdentityField(view_name='optioncontract-detail') # Added for hyperlinking
    underlying_asset_symbol = serializers.CharField(source='underlying_asset.symbol', read_only=True)
    underlying_asset = serializers.HyperlinkedRelatedField(view_name='asset-detail', read_only=True) # For linking
    # 'premium' is not a field in the OptionContract model.
    # It is usually the 'price' in a Transaction when buying/selling an option.
    # Removing 'premium' from this serializer as per previous reasoning.

    class Meta:
        model = OptionContract
        fields = ['id', 'url', 'underlying_asset', 'underlying_asset_symbol', 'option_type', 'strike_price', 'expiration_date']
        # extra_kwargs removed as underlying_asset is now HyperlinkedRelatedField or handled by it

class TransactionSerializer(serializers.ModelSerializer): # Changed to ModelSerializer
    url = serializers.HyperlinkedIdentityField(view_name='transaction-detail') # Added for hyperlinking
    asset_symbol = serializers.CharField(source='asset.symbol', read_only=True)
    asset = serializers.HyperlinkedRelatedField(view_name='asset-detail', read_only=True) # For linking
    related_option_str = serializers.StringRelatedField(source='related_option', read_only=True, allow_null=True)
    related_option = serializers.HyperlinkedRelatedField(view_name='optioncontract-detail', read_only=True, allow_null=True) # For linking

    class Meta:
        model = Transaction
        fields = [
            'id', 'url', 'asset', 'asset_symbol', 'transaction_type', 
            'date', 'quantity', 'price', 'commission', 
            'related_option', 'related_option_str'
        ]
        # extra_kwargs removed as asset and related_option are now HyperlinkedRelatedField or handled by them

class PortfolioSerializer(serializers.ModelSerializer): # Changed to ModelSerializer
    url = serializers.HyperlinkedIdentityField(view_name='portfolio-detail') # Added for hyperlinking
    user = serializers.StringRelatedField(read_only=True) 
    assets = AssetSerializer(many=True, read_only=True) 
    transactions = TransactionSerializer(many=True, read_only=True, source='get_all_transactions') # Correctly using source

    class Meta:
        model = Portfolio
        fields = ['id', 'url', 'name', 'user', 'assets', 'transactions']
