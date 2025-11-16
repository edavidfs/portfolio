set shell := ["bash", "-lc"]

# Empaqueta la app Angular dentro del wrapper Tauri.
build:
    (cd frontend && npm run build)
    (cd src-tauri && cargo tauri build)

# Levanta la app en modo desarrollo con Tauri (cargo tauri dev lanza ng serve gracias a beforeDevCommand).
dev:
    (cd src-tauri && cargo tauri dev)

# Instala las dependencias del frontend (Angular) para desarrollo local.
install_dev:
    npm --prefix frontend install

# Instala la CLI de Tauri (requiere Rust y cargo).
install_tauri:
    cargo install tauri-cli --locked

# Instala todo el entorno (frontend + CLI Tauri).
install_all: install_dev install_tauri
