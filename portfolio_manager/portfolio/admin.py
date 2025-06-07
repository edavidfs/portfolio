from django.contrib import admin
from .models import Asset, OptionContract, Transaction, Portfolio, InvestmentAccount, AccountTransaction

# Register your models here.

class AssetAdmin(admin.ModelAdmin):
    list_display = ('symbol', 'name', 'asset_type')
    search_fields = ('symbol', 'name')
    list_filter = ('asset_type',)

admin.site.register(Asset, AssetAdmin)

class OptionContractAdmin(admin.ModelAdmin):
    list_display = ('underlying_asset', 'option_type', 'strike_price', 'expiration_date')
    list_filter = ('option_type', 'expiration_date', 'underlying_asset__symbol') # Filter by symbol
    search_fields = ('underlying_asset__symbol',)
    raw_id_fields = ('underlying_asset',) # For better performance with many assets

admin.site.register(OptionContract, OptionContractAdmin)

class TransactionAdmin(admin.ModelAdmin):
    list_display = ('date', 'asset', 'transaction_type', 'quantity', 'price', 'related_option_display')
    list_filter = ('transaction_type', 'date', 'asset__symbol') # Filter by symbol
    search_fields = ('asset__symbol', 'related_option__underlying_asset__symbol')
    raw_id_fields = ('asset', 'related_option') # For better performance

    def related_option_display(self, obj):
        if obj.related_option:
            return str(obj.related_option)
        return "-"
    related_option_display.short_description = 'Related Option'

admin.site.register(Transaction, TransactionAdmin)

class PortfolioAdmin(admin.ModelAdmin):
    list_display = ('name', 'user')
    list_filter = ('user',)
    search_fields = ('name', 'user__username')
    filter_horizontal = ('assets',) # For easier management of ManyToManyField

admin.site.register(Portfolio, PortfolioAdmin)
admin.site.register(InvestmentAccount)
admin.site.register(AccountTransaction)
