# Deployment Guide: Portfolio Manager

This guide provides instructions on how to set up and run the Portfolio Manager application using either a Python virtual environment or Docker.

## Prerequisites

*   Python 3.9 or higher
*   pip (Python package installer)
*   Git
*   Docker and Docker Compose (if using Docker deployment)
*   PostgreSQL client tools (optional, for interacting with Dockerized DB directly)

## I. Setup using Python Virtual Environment

1.  **Clone the Repository:**
    ```bash
    git clone <repository_url>
    cd <repository_root_directory_name> # e.g., portfolio-manager-project
    ```
    Replace `<repository_root_directory_name>` with the name of the directory created by `git clone`.

2.  **Create and Activate Virtual Environment:**
    ```bash
    python -m venv venv
    # On macOS/Linux
    source venv/bin/activate
    # On Windows
    # venv\Scripts\activate
    ```

3.  **Install Dependencies:**
    Make sure you are in the project root directory where `requirements.txt` is located.
    ```bash
    pip install -r requirements.txt
    ```

4.  **Set Up Environment Variables:**
    Copy the `.env.example` file to `.env` and update the variables:
    ```bash
    cp .env.example .env
    # Open .env and edit:
    # - SECRET_KEY: Generate a strong secret key.
    # - DEBUG: Set to False for production, True for development.
    # - DATABASE_URL: If using a separate PostgreSQL server, configure its URL.
    #   For local development with SQLite (default if DATABASE_URL is not set or invalid in .env), this can be left as is or commented out.
    ```
    If you are using SQLite for local development (the default fallback in `settings.py` if `DATABASE_URL` is not set in `.env`), you don't strictly need to define `DATABASE_URL` in `.env`.

5.  **Run Database Migrations:**
    Assuming you are in the repository root (e.g., `portfolio-manager-project`):
    ```bash
    python portfolio_manager/manage.py makemigrations portfolio
    python portfolio_manager/manage.py migrate
    ```

6.  **Create a Superuser (Optional but Recommended):**
    To access the Django admin interface.
    ```bash
    python portfolio_manager/manage.py createsuperuser
    ```

7.  **Run the Development Server:**
    ```bash
    python portfolio_manager/manage.py runserver
    ```
    The application will be available at `http://127.0.0.1:8000/`.

8.  **Running for Production (with Gunicorn):**
    From the repository root:
    ```bash
    # Ensure your virtual environment is activated
    # The Gunicorn command needs to be run from a directory where portfolio_manager.wsgi can be found.
    # Given our structure, portfolio_manager (the one with manage.py) is the project root.
    # And portfolio_manager.wsgi refers to portfolio_manager/portfolio_manager/wsgi.py
    # The Dockerfile CMD is: gunicorn --bind 0.0.0.0:8000 portfolio_manager.wsgi:application
    # This implies the WORKDIR in Docker is /app, and /app/portfolio_manager/wsgi.py is the path.
    # For local virtual env, if you are in the repo root, the command would be:
    gunicorn --bind 0.0.0.0:8000 portfolio_manager.portfolio_manager.wsgi:application -D
    ```
    Ensure `DEBUG` is set to `False` in your `.env` file for production. You might need to configure static file serving separately with a web server like Nginx in a true production setup. The WSGI path `portfolio_manager.portfolio_manager.wsgi:application` assumes the `portfolio_manager` (outer) directory is in the Python path, and refers to the `wsgi.py` file within the inner `portfolio_manager` directory.

## II. Setup using Docker and Docker Compose

This is recommended for a consistent development environment and easier deployment.

1.  **Clone the Repository:**
    ```bash
    git clone <repository_url>
    cd <repository_root_directory_name> # e.g., portfolio-manager-project
    ```

2.  **Set Up Environment Variables:**
    Copy `.env.example` to `.env` and customize it.
    ```bash
    cp .env.example .env
    # Open .env and edit SECRET_KEY, DEBUG, and other variables as needed.
    # The DATABASE_URL should point to the Dockerized PostgreSQL instance:
    # DATABASE_URL=postgres://portfolio_user:portfolio_password@db:5432/portfolio_db
    # POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB in .env will be used by docker-compose.yml to initialize the db service.
    ```

3.  **Build and Run Docker Containers:**
    ```bash
    docker-compose up --build -d
    ```
    The `-d` flag runs containers in detached mode. Omit it to see logs in the foreground.

4.  **Run Database Migrations (inside Docker container):**
    Once the containers are running, execute migrations in the `web` service. The path to `manage.py` is relative to `/app` (WORKDIR in Dockerfile).
    ```bash
    docker-compose exec web python portfolio_manager/manage.py makemigrations portfolio
    docker-compose exec web python portfolio_manager/manage.py migrate
    ```

5.  **Create a Superuser (inside Docker container):**
    ```bash
    docker-compose exec web python portfolio_manager/manage.py createsuperuser
    ```

6.  **Accessing the Application:**
    The application will be available at `http://localhost:8000/`.
    The Django admin will be at `http://localhost:8000/admin/`.
    The API will be at `http://localhost:8000/portfolio/api/`.

7.  **Stopping Docker Containers:**
    ```bash
    docker-compose down
    ```
    To remove volumes (like PostgreSQL data), use `docker-compose down -v`.

## Basic Troubleshooting

*   **Port Conflicts:** If port 8000 is in use, change the port mapping in `docker-compose.yml` (e.g., `"8001:8000"`) or the `runserver` command.
*   **Missing Dependencies:** Ensure `pip install -r requirements.txt` completed successfully or `docker-compose build` ran without errors.
*   **Database Connection Issues (Docker):**
    *   Verify `DATABASE_URL` in `.env` matches the PostgreSQL service details in `docker-compose.yml`.
    *   Check Docker logs: `docker-compose logs db` and `docker-compose logs web`.
*   **`manage.py` path:** The project structure has `manage.py` inside the `portfolio_manager` directory (e.g. `repo_root/portfolio_manager/manage.py`). The instructions assume you run `python portfolio_manager/manage.py ...` commands from the repository root.
*   **WSGI Path for Gunicorn (Virtual Env):** The WSGI path for Gunicorn in a virtual environment setup is `portfolio_manager.portfolio_manager.wsgi:application` when run from the repository root. This is because `portfolio_manager` (the directory containing `manage.py`) is the effective project root, and the `wsgi.py` file is inside the inner `portfolio_manager` directory (the Django configuration directory).

## Further Production Considerations

*   **Static Files:** For production, Django's `collectstatic` should be used (e.g., `docker-compose exec web python portfolio_manager/manage.py collectstatic --noinput`). A web server like Nginx should be configured to serve static files and proxy pass to Gunicorn. The Dockerfile should be updated to run `collectstatic` during the build.
*   **HTTPS:** Secure your application with HTTPS using SSL/TLS certificates (e.g., via Nginx and Let's Encrypt).
*   **Allowed Hosts:** Configure `ALLOWED_HOSTS` in `settings.py` (ideally via environment variables) for your production domain(s).
*   **Backup Database:** Regularly back up your PostgreSQL database.

```
