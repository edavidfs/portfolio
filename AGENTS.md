# Repository Guidelines

## Estructura del Proyecto y Módulos
- `frontend/`: app Angular (componentes, servicios y estilos). Punto de entrada en `src/app`.
- `src-tauri/`: capa Rust que empaqueta la app de escritorio (Tauri) y puentea con el backend.
- `backend/`: API en Python (FastAPI) con importadores y sincronización de precios.
- `portafolio-*.csv`: datos de ejemplo para pruebas locales.
- `.env` y `.gitignore`: uso local; no subir secretos ni datos personales.

## Comandos de Desarrollo y Pruebas
- Frontend: `cd frontend && npm install` (una vez) y `npm start` para servir Angular en dev.
- Backend: `cd backend && uvicorn api.main:app --reload` (usa `python3 -m venv .venv && pip install -r requirements.txt` si falta entorno).
- Desktop (Tauri): `cd frontend && npx tauri dev` para ejecutar la app de escritorio con Rust.
- Builds: `cd frontend && npm run build` para Angular; empaquetado Tauri con `npx tauri build`.
- Pruebas frontend: `cd frontend && npm test`. Backend: validación manual de endpoints con curl/HTTPie o cliente preferido.

## Estilo de Código y Nombres
- TypeScript/Angular: sangría 2 espacios, `const/let`, tipado explícito, servicios inyectables pequeños, componentes con inputs/outputs claros.
- Python: `black`/`ruff` como referencia (PEP 8), funciones cortas y puras, uso de `dataclass` cuando aplique.
- Rust (Tauri): seguir `rustfmt`, módulos pequeños y autocontenidos; evitar lógica de negocio en Rust si ya existe en backend.
- Nombres: `camelCase` para variables/funciones, `PascalCase` para clases/componentes; ficheros en minúsculas y descriptivos.

## Guías de Pruebas
- Flujos mínimos a validar: importar CSVs (operaciones, transferencias, dividendos), ver tablas consolidadas, gráfico de caja y precios actuales por ticker.
- Backend: probar `/health`, importadores y endpoints de precios al menos con un caso feliz y uno de error.
- Desktop: ejecutar `tauri dev` y verificar integración Angular ↔ backend (CORS/puertos, rutas locales).

## Commits y Pull Requests
- Commits: mensaje corto en presente imperativo.
  - Ejemplos: "Añadir sync de precios diarios", "Exponer endpoint de dividendos", "Ajustar tabla de posiciones".
- PRs: propósito, cambios clave, pasos de prueba (comandos y CSV usado), capturas si hay cambios de UI. Enlazar issues y mantener alcance acotado.

## Seguridad y Configuración
- No comprometer secretos ni datos reales. `.env` solo para valores locales.
- Revisar CORS entre backend y frontend/Tauri; servir sobre HTTPS en producción.
- Variables útiles: `PORTFOLIO_DB_PATH` para ruta de la base local; usa rutas de datos en `user_data_dir` por defecto.

## Instrucciones para Agentes
- Escribir siempre en castellano: código, comentarios, mensajes de commit y PRs.
- Siglas sugeridas (prefijo `A-`): Producto/MVP (`A-PO`), Arquitectura (`A-AR`), Datos/Backend (`A-DB`), UI/UX (`A-UI`), Trading/Estadística (`A-TR`), Integración Tauri (`A-TA`), DevOps/Calidad (`A-QA`).
- Roles sugeridos (responsabilidades y entregables):
  - **Producto/MVP (A-PO)**: define alcance y roadmap; entregables: backlog priorizado y criterios de aceptación por iteración.
  - **Arquitectura (A-AR)**: contratos API, eventos y límites entre Angular, backend y Tauri; entregables: especificaciones de endpoints, diagramas simples y convenciones de estado/errores.
  - **Datos/Backend (Python) (A-DB)**: modelo de datos, importadores, endpoints y sincronización de precios; entregables: esquemas, validación/idempotencia y logs/alertas básicas.
  - **UI/UX (Angular) (A-UI)**: componentes, tablas y gráficas; entregables: vistas responsivas, manejo de errores y estados vacíos/cargando, accesibilidad básica.
  - **Trading/Estadística (A-TR)**: métricas (rendimientos, drawdown, riesgo) y señales ligeras/backtests acotados; entregables: cálculos verificables y endpoints/servicios para consumo en UI.
  - **Integración (Tauri/Rust) (A-TA)**: permisos de filesystem/red, empaquetado y puente a backend; entregables: configuración Tauri, manejo de rutas locales y actualización de la app.
- **DevOps/Calidad (A-QA)**: scripts de entorno, lint/format, chequeos manuales con CSV de muestra y checklist de regresiones; entregables: scripts de arranque, guías de prueba y reporte de hallazgos.

## Metodología de trabajo (TDD)
- Default: aplicar TDD en backend Python, servicios Angular y utilidades Rust. Cada cambio de lógica debe ir con prueba unitaria o de integración que falle antes y pase después.
- **A-PO/A-AR**: incluir criterios de aceptación que puedan traducirse en casos de prueba.
- **A-DB**: añadir tests de importadores, agregaciones y endpoints (caso feliz + edge). Mockear I/O externo y validar idempotencia.
- **A-UI**: usar pruebas de componentes/servicios en Angular (estado feliz, errores, vacíos/cargando). Evitar lógica sin cobertura.
- **A-TR**: acompañar cada métrica con test numérico reproducible (dataset pequeño) y tolerancias explícitas.
- **A-TA**: pruebas mínimas de integración Tauri (puente a backend y permisos de archivos) cuando cambie la configuración.
- **A-QA**: validar que la batería de tests se ejecuta en CI/local y documentar brevemente gaps conocidos si los hay.
