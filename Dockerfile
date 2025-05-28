# Start with a Python base image
FROM python:3.9-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Set work directory
WORKDIR /app

# Install system dependencies (if any are ever needed, e.g., for psycopg2 build from source)
# RUN apt-get update && apt-get install -y ...

# Install Python dependencies
# requirements.txt is at the root of the repo, so it will be copied from there.
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy project code
# The `portfolio_manager` directory from the repo root contains manage.py and the Django project itself.
COPY portfolio_manager/ /app/
# After this, /app/manage.py will exist, and /app/portfolio_manager/ will be the Django project dir.
# This means the WSGI application path will be portfolio_manager.wsgi:application, which is correct.

# Expose port
EXPOSE 8000

# Run gunicorn
# The project name as per settings.py and wsgi.py is 'portfolio_manager'
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "portfolio_manager.wsgi:application"]
