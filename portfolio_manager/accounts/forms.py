from django import forms
from django.contrib.auth.forms import UserCreationForm, UserChangeForm # Import UserChangeForm
from django.contrib.auth.models import User

class RegistrationForm(UserCreationForm):
    class Meta(UserCreationForm.Meta):
        model = User
        # Ensure email is part of the form, and it's unique if required by User model
        fields = UserCreationForm.Meta.fields + ('email',) # This adds 'email' to the default UserCreationForm fields

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        placeholders = {
            'username': 'Username',
            'email': 'Email Address',
            'password1': 'Password', # UserCreationForm uses password1 and password2
            'password2': 'Confirm Password'
        }
        for field_name, field in self.fields.items():
            field.widget.attrs.update({'class': 'form-control'})
            if field_name in placeholders:
                field.widget.attrs.update({'placeholder': placeholders[field_name]})

class LoginForm(forms.Form):
    username = forms.CharField()
    password = forms.CharField(widget=forms.PasswordInput)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        placeholders = {
            'username': 'Username',
            'password': 'Password'
        }
        for field_name, field in self.fields.items():
            field.widget.attrs.update({'class': 'form-control'})
            if field_name in placeholders:
                field.widget.attrs.update({'placeholder': placeholders[field_name]})

class UserUpdateForm(UserChangeForm):
    password = None # Remove password field from UserChangeForm

    class Meta:
        model = User
        fields = ('username', 'email', 'first_name', 'last_name')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # UserChangeForm does not have password1/password2, it has 'password' but we removed it.
        # The fields are 'username', 'email', 'first_name', 'last_name'.
        placeholders = {
            'username': 'Username',
            'email': 'Email Address',
            'first_name': 'First Name',
            'last_name': 'Last Name'
        }
        for field_name, field in self.fields.items():
            if field: # Ensure field exists (UserChangeForm might have None for password)
                field.widget.attrs.update({'class': 'form-control'})
                if field_name in placeholders:
                    field.widget.attrs.update({'placeholder': placeholders[field_name]})
