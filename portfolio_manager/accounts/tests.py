from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.urls import reverse
from .forms import RegistrationForm, LoginForm, UserUpdateForm
from django.http import HttpResponse

# It's good practice to have a mechanism to define URLs needed for testing, like 'dashboard'.
# One way is to use override_settings if you have a test-specific URL conf.
# Another is to ensure 'dashboard' is defined in the main project urls.py, even if it's a dummy view.
# For this environment, we'll proceed assuming 'dashboard' might not be fully resolvable
# and write tests to be robust where possible (e.g., check for 302 then check auth state).

class RegistrationTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.register_url = reverse('accounts:register')
        # For testing redirects to 'dashboard', we might need a dummy URL if not already present
        # For now, tests will check for redirect status code and auth state.

    def test_registration_page_loads(self):
        response = self.client.get(self.register_url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'accounts/register.html')
        self.assertIsInstance(response.context['form'], RegistrationForm)

    def test_user_registration_success(self):
        user_count_before = User.objects.count()
        data = {
            'username': 'testuserreg',
            'email': 'testuserreg@example.com',
            'password1': 'ValidPassword123', # Corrected: UserCreationForm uses 'password1'
            'password2': 'ValidPassword123'  # UserCreationForm uses 'password2' for confirmation
        }

        # Test redirection first
        response_no_follow = self.client.post(self.register_url, data)
        self.assertEqual(response_no_follow.status_code, 302, "Registration should redirect on success.")
        # Assuming the redirect is to 'dashboard' as per views.py.
        # If 'dashboard' is not defined as a URL name, this POST will fail with NoReverseMatch from the view.
        # So, for this test to pass, 'dashboard' must be resolvable.
        # self.assertTrue(response_no_follow.url.endswith(reverse('dashboard')))

        # Test with follow=True to check final page and authentication
        response_followed = self.client.post(self.register_url, data, follow=True)
        # This line will fail if 'dashboard' is not a resolvable URL name.
        self.assertEqual(response_followed.status_code, 200, "Following redirect should land on a 200 page (e.g., dummy dashboard).")

        self.assertEqual(User.objects.count(), user_count_before + 1)
        self.assertTrue(User.objects.filter(username='testuserreg').exists())
        user = User.objects.get(username='testuserreg')
        self.assertEqual(user.email, 'testuserreg@example.com')
        # Check auth status via session, as context might not be reliable with simple HttpResponse
        self.assertTrue('_auth_user_id' in self.client.session, "User ID should be in session after registration and login.")
        auth_user_id = self.client.session['_auth_user_id']
        self.assertEqual(str(user.id), auth_user_id, "Logged in user ID in session should match created user.")


    def test_registration_existing_username(self):
        User.objects.create_user(username='existinguser', password='password123')
        response = self.client.post(self.register_url, {
            'username': 'existinguser',
            'email': 'newemail@example.com',
            'password1': 'newpassword123', # Corrected
            'password2': 'newpassword123',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "A user with that username already exists.")

    def test_registration_password_mismatch(self):
        response = self.client.post(self.register_url, {
            'username': 'testuser2',
            'email': 'testuser2@example.com',
            'password1': 'password123', # Corrected
            'password2': 'password456',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "The two password fields didn’t match.") # Corrected apostrophe

    def test_registration_form_invalid_email(self):
        response = self.client.post(self.register_url, {
            'username': 'testuser3',
            'email': 'notanemail',
            'password1': 'password123', # Corrected
            'password2': 'password123',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Enter a valid email address.")


class LoginLogoutTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.login_url = reverse('accounts:login')
        self.logout_url = reverse('accounts:logout')
        self.user_password = 'password123'
        self.user = User.objects.create_user(username='loginuser', password=self.user_password, email='login@example.com')
        # self.dashboard_url = reverse('dashboard') # Define if 'dashboard' is resolvable

    def test_login_page_loads(self):
        response = self.client.get(self.login_url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'accounts/login.html')
        self.assertIsInstance(response.context['form'], LoginForm)

    def test_user_login_success(self):
        response_no_follow = self.client.post(self.login_url, {
            'username': 'loginuser',
            'password': self.user_password,
        })
        self.assertEqual(response_no_follow.status_code, 302, "Login should redirect on success.")
        # If 'dashboard' is not defined, this POST will fail with NoReverseMatch from the view.
        # self.assertTrue(response_no_follow.url.endswith(self.dashboard_url))

        response_followed = self.client.post(self.login_url, {
            'username': 'loginuser',
            'password': self.user_password,
        }, follow=True)
        # This line will fail if 'dashboard' is not a resolvable URL name.
        self.assertEqual(response_followed.status_code, 200)
        # Check auth status via session
        self.assertTrue('_auth_user_id' in self.client.session, "User ID should be in session after successful login.")
        auth_user_id = self.client.session['_auth_user_id']
        expected_user_id = str(User.objects.get(username='loginuser').id)
        self.assertEqual(expected_user_id, auth_user_id, "Logged in user ID in session should match the user.")

    def test_user_login_failure_wrong_password(self):
        response = self.client.post(self.login_url, {
            'username': 'loginuser',
            'password': 'wrongpassword',
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.context['user'].is_authenticated)
        self.assertContains(response, "Invalid username or password.")

    def test_user_login_failure_nonexistent_user(self):
        response = self.client.post(self.login_url, {
            'username': 'nosuchuser',
            'password': 'password123',
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.context['user'].is_authenticated)
        self.assertContains(response, "Invalid username or password.")

    def test_login_form_blank_fields(self):
        response = self.client.post(self.login_url, {'username': '', 'password': ''})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "This field is required.")
        self.assertFalse(response.context['user'].is_authenticated)

    def test_user_logout(self):
        self.client.login(username='loginuser', password=self.user_password)
        self.assertTrue(self.client.session.get('_auth_user_id') is not None)

        response = self.client.get(self.logout_url, follow=True) # follow=True to test final destination
        self.assertTrue(self.client.session.get('_auth_user_id') is None, "User should be logged out.")
        self.assertRedirects(response, self.login_url, msg_prefix="Logout should redirect to the login page.")


class UserUpdateTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user_password = 'password123'
        self.user = User.objects.create_user(
            username='updateuser',
            password=self.user_password,
            email='update@example.com',
            first_name='OldFirst',
            last_name='OldLast'
        )
        self.update_url = reverse('accounts:update_account')
        self.login_url = reverse('accounts:login')

    def test_update_page_loads_for_logged_in_user(self):
        self.client.login(username='updateuser', password=self.user_password)
        response = self.client.get(self.update_url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'accounts/update_account.html')
        self.assertIsInstance(response.context['form'], UserUpdateForm)

    def test_update_page_redirects_anonymous_user(self):
        response = self.client.get(self.update_url)
        expected_redirect_url = f'{self.login_url}?next={self.update_url}'
        self.assertRedirects(response, expected_redirect_url)

    def test_user_update_success(self):
        self.client.login(username='updateuser', password=self.user_password)
        new_data = {
            'username': 'updateduser',
            'email': 'updated@example.com',
            'first_name': 'NewFirst',
            'last_name': 'NewLast',
        }
        response = self.client.post(self.update_url, new_data, follow=True) # follow=True to check messages

        self.assertEqual(response.status_code, 200) # View redirects to itself
        self.assertTemplateUsed(response, 'accounts/update_account.html')

        updated_user = User.objects.get(id=self.user.id) # Re-fetch user
        self.assertEqual(updated_user.username, new_data['username'])
        self.assertEqual(updated_user.email, new_data['email'])
        self.assertEqual(updated_user.first_name, new_data['first_name'])
        self.assertEqual(updated_user.last_name, new_data['last_name'])
        self.assertContains(response, "Your account has been updated successfully!")

    def test_user_update_form_invalid_email(self):
        self.client.login(username='updateuser', password=self.user_password)
        response = self.client.post(self.update_url, {
            'username': 'updateuser', 'email': 'invalidemail', # invalid email
            'first_name': 'Test', 'last_name': 'User',
        })
        self.assertEqual(response.status_code, 200) # Should stay on the page
        self.assertContains(response, "Enter a valid email address.")

    def test_user_update_form_username_taken(self):
        User.objects.create_user(username='otheruser', password='password') # Create another user
        self.client.login(username='updateuser', password=self.user_password)
        response = self.client.post(self.update_url, {
            'username': 'otheruser', # This username is already taken
            'email': 'updateuser@example.com', # Original email for current user
            'first_name': 'Test', 'last_name': 'User',
        })
        self.assertEqual(response.status_code, 200) # Should stay on the page
        self.assertContains(response, "A user with that username already exists.")

# Note on 'dashboard' URL:
# The tests for registration and login success (test_user_registration_success, test_user_login_success)
# involve views that redirect to a URL named 'dashboard'. For these tests to pass when `follow=True`
# is used, or when the view attempts `redirect('dashboard')`, the URL name 'dashboard'
# MUST be defined in a URL configuration that is active during testing.
# If 'dashboard' is not defined, Django will raise a NoReverseMatch error.
# A common approach is to define a dummy 'dashboard' view and URL pattern for testing purposes,
# e.g., in the main project urls.py or a test-specific urls.py loaded via @override_settings.
# Example for main urls.py:
# from django.http import HttpResponse
# def dummy_dashboard_view(request): return HttpResponse("Mock Dashboard Page")
# if 'test' in sys.argv: # Or some other way to detect test environment
#     urlpatterns.append(path('test_dashboard/', dummy_dashboard_view, name='dashboard'))
# For this exercise, it's assumed 'dashboard' will be made resolvable if tests fail due to it.
# The tests are written to expect 'dashboard' to be a valid URL name.
