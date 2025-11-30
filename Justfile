set shell := ["bash", "-lc"]

# Empaqueta la app Angular dentro del wrapper Tauri.
build:
    (cd frontend && npm run build)
    (cd src-tauri && cargo tauri build)

# Arranca el backend FastAPI (requiere .venv creado con uv).
backend:
    (cd backend && source .venv/bin/activate && PYTHONPATH=.. uvicorn backend.api.main:app --reload)

# Levanta la app en modo desarrollo con Tauri (cargo tauri dev lanza ng serve gracias a beforeDevCommand).
dev:
    (cd src-tauri && cargo tauri dev)

# Actualiza los paq uetes de rust
update:
    (cd src-tauri && cargo update)

# Instala las dependencias del frontend (Angular) para desarrollo local.
install_dev:
    npm --prefix frontend install

# Instala la CLI de Tauri (requiere Rust y cargo).
install_tauri:
    cargo install tauri-cli --locked

# Instala todo el entorno (frontend + CLI Tauri).
install_all: install_dev install_backend install_tauri

# Instala los requirements del backend usando uv (crea .venv si no existe).
install_backend:
    (cd backend && uv --no-config venv .venv)
    (cd backend && uv --no-config sync)

# Ejecuta los tests del backend con pytest.
test_backend:
    (cd backend && source .venv/bin/activate && pytest -q)

# Ejecuta los tests del backend mostrando prints (captura deshabilitada).
test_backend_verbose:
    (cd backend && source .venv/bin/activate && pytest -s)

# Ejecuta los tests del frontend (Angular) en modo headless.
test_frontend:
    (cd frontend && npm test -- --watch=false --browsers=ChromeHeadless)
