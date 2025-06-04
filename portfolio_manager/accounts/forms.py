from django import forms
from django.contrib.auth.forms import UserCreationForm, UserChangeForm # Import UserChangeForm
from django.contrib.auth.models import User

class RegistrationForm(UserCreationForm):
    class Meta(UserCreationForm.Meta):
        model = User
        # Ensure email is part of the form, and it's unique if required by User model
        fields = UserCreationForm.Meta.fields + ('email',)

class LoginForm(forms.Form):
    username = forms.CharField()
    password = forms.CharField(widget=forms.PasswordInput)

class UserUpdateForm(UserChangeForm):
    password = None # Remove password field from UserChangeForm

    class Meta:
        model = User
        fields = ('username', 'email', 'first_name', 'last_name')
