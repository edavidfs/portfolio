from django.shortcuts import render
from django.http import HttpResponse, JsonResponse # Added JsonResponse for structured response
from rest_framework import viewsets
# from rest_framework import permissions # Will add later if needed

from .forms import CSVUploadForm
from .services import process_csv # Import process_csv
from .models import Asset, OptionContract, Transaction, Portfolio
from .serializers import AssetSerializer, OptionContractSerializer, TransactionSerializer, PortfolioSerializer


# Existing CSV upload view
def upload_csv_view(request):
    if request.method == 'POST':
        form = CSVUploadForm(request.POST, request.FILES)
        if form.is_valid():
            csv_file = request.FILES['csv_file']
            # For now, portfolio_id is None. This will be updated later.
            # Assuming process_csv is intended to be used by an authenticated user for their portfolio
            # This view might need user context if portfolio_id is tied to request.user
            result = process_csv(csv_file, portfolio_id=None) 
            return JsonResponse(result) # Return the result from process_csv
        else:
            # If form is not valid, re-render the template with the form (containing errors)
            # and potentially an error message.
            return render(request, 'portfolio/upload_csv.html', {'form': form, 'errors': form.errors})
    else:
        form = CSVUploadForm()
    return render(request, 'portfolio/upload_csv.html', {'form': form})


# DRF ViewSets

class AssetViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint that allows assets to be viewed.
    """
    queryset = Asset.objects.all()
    serializer_class = AssetSerializer

class OptionContractViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint that allows option contracts to be viewed.
    """
    queryset = OptionContract.objects.all()
    serializer_class = OptionContractSerializer

class TransactionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint that allows transactions to be viewed.
    """
    queryset = Transaction.objects.all().order_by('-date', '-id')
    serializer_class = TransactionSerializer

class PortfolioViewSet(viewsets.ModelViewSet): # Changed to ModelViewSet for future CRUD
    """
    API endpoint that allows portfolios to be viewed and managed.
    """
    queryset = Portfolio.objects.all()
    serializer_class = PortfolioSerializer
    # permission_classes = [permissions.IsAuthenticatedOrReadOnly] # Optional for now
