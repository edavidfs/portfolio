# Repository Guidelines

## Estructura del Proyecto y Módulos
- `index.html`: Página única con la UI y scripts/CDNs.
- `logic.js`: Lógica de la app (carga CSV, agregaciones, tablas, gráficos, fetch de precios).
- `persistence.js`: Capa de datos con SQL.js + snapshot en `localStorage`.
- `portafolio-dividendos.csv`: Datos de ejemplo para pruebas locales.
- `.env` y `.gitignore`: Uso local; no subir secretos ni datos personales.

## Comandos de Desarrollo y Pruebas
- Servir localmente (estático):
  - `python3 -m http.server 8000` y abrir `http://localhost:8000`.
  - o `npx serve` en la raíz del repo.
- Sin build: HTML/JS planos; dependencias por CDN (Chart.js, SQL.js, Papa Parse).

## Estilo de Código y Nombres
- JavaScript: sangría de 2 espacios, `const/let`, `===`, funciones pequeñas y puras.
- Nombres: `camelCase` para variables/funciones, `PascalCase` para clases.
- Ficheros: minúsculas y descriptivos (p. ej. `charts.js`, `utils.js`).
- Separación: UI y orquestación en `logic.js`; almacenamiento en `persistence.js`.

## Guías de Pruebas
- Framework: no hay por ahora. Validación manual:
  - Importar CSVs y comprobar tablas de posiciones, transferencias, dividendos (diario/por activo) y gráfico de caja.
  - Recargar la página para verificar persistencia vía `persistence.js`.
  - Limpiar estado: `localStorage.removeItem('portfolioDB')` en la consola.
  - Verificar algunos tickers para precios actuales.

## Commits y Pull Requests
- Commits: mensaje corto en presente imperativo. Ejemplos:
  - "Add dividend import and tabs"
  - "Permitir múltiples CSV de transferencias"
  - "Registrar dividendos únicos por ActionID"
- PRs: propósito, cambios clave, pasos de prueba (CSV usado), y capturas de tablas/gráficos si hay cambios de UI. Enlazar issues y mantener el alcance acotado.

## Seguridad y Configuración
- No comprometer secretos ni datos reales. `.env` solo para valores locales.
- Servir sobre HTTPS en producción; cuidar CORS al añadir nuevas fuentes.

## Instrucciones para Agentes
- Escribir siempre en castellano: código, comentarios, mensajes de commit y PRs.
