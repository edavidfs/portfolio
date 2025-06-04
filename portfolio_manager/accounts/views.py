from django.shortcuts import render, redirect
from django.contrib.auth import login, authenticate, logout
from .forms import RegistrationForm, LoginForm, UserUpdateForm # Import UserUpdateForm
from django.contrib.auth.decorators import login_required # Import login_required
from django.contrib import messages # Import messages

def register_view(request):
    if request.method == 'POST':
        form = RegistrationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect('dashboard')  # Assuming 'dashboard' is a named URL
    else:
        form = RegistrationForm()
    return render(request, 'accounts/register.html', {'form': form})

def login_view(request):
    if request.method == 'POST':
        form = LoginForm(request.POST)
        if form.is_valid():
            username = form.cleaned_data.get('username')
            password = form.cleaned_data.get('password')
            user = authenticate(request, username=username, password=password)
            if user is not None:
                login(request, user)
                return redirect('dashboard')  # Assuming 'dashboard' is a named URL
            else:
                # Add an error message for invalid login
                form.add_error(None, "Invalid username or password.")
    else:
        form = LoginForm()
    return render(request, 'accounts/login.html', {'form': form})

def logout_view(request):
    logout(request)
    return redirect('accounts:login')  # Corrected to use namespace

def landing_page_view(request):
    return render(request, 'accounts/landing_page.html')

@login_required
def update_account_view(request):
    if request.method == 'POST':
        form = UserUpdateForm(request.POST, instance=request.user)
        if form.is_valid():
            form.save()
            messages.success(request, 'Your account has been updated successfully!')
            return redirect('accounts:update_account') # Redirect back to the same page or to dashboard
    else:
        form = UserUpdateForm(instance=request.user)
    return render(request, 'accounts/update_account.html', {'form': form})
