## Guía de Desarrollo

Esta guía resume la estructura del repositorio, el flujo de la aplicación y las prácticas recomendadas para contribuir. Todo se mantiene en castellano: código, comentarios y comunicación.

## Estructura del Repositorio

- `index.html`: Página única con la UI y scripts por CDN.
- `logic.js`: Orquestación y lógica de negocio (carga de CSV, agregaciones, tablas, gráficos, fetch de precios).
- `persistence.js`: Capa de datos con SQL.js y snapshot en `localStorage`.
- `portafolio-dividendos.csv`: Datos de ejemplo para pruebas locales.
- `.env`: Variables locales (no subir a Git).
- `.gitignore`: Exclusiones (incluye `.env` y artefactos locales).

Nota: Proyecto plano sin build; todo vive en la raíz.

## Flujo de la Aplicación

1. Importar CSV desde la UI usando Papa Parse (`logic.js`).
2. Persistir en memoria con SQL.js y snapshot a `localStorage` (`persistence.js`).
3. Calcular agregaciones para posiciones, transferencias y dividendos (diario y por activo).
4. Renderizar tablas y gráficos en `index.html` con Chart.js/DOM APIs.
5. (Opcional) Obtener precios actuales por ticker, cuidando CORS/HTTPS.

## Desarrollo Local

- Servir como sitio estático:
  - `python3 -m http.server 8000` y abrir `http://localhost:8000`.
  - o `npx serve` en la raíz del repo.
- No hay bundlers: dependencias por CDN en `index.html` (Chart.js, SQL.js, Papa Parse).

## Dependencias (CDN)

- Chart.js: gráficos.
- SQL.js: SQLite en el navegador para consultas en memoria.
- Papa Parse: parseo de CSV en el cliente.

Mantén versiones fijas en los enlaces CDN para evitar roturas inesperadas.

## Estilo de Código

- JavaScript: sangría de 2 espacios, `const/let`, `===`.
- Funciones pequeñas y preferentemente puras.
- Nombres: `camelCase` para variables/funciones; `PascalCase` para clases.
- Separación: UI/orquestación en `logic.js`; almacenamiento/consultas en `persistence.js`.
- Ficheros: minúsculas y descriptivos (p. ej. `charts.js`, `utils.js`).

## Pruebas Manuales

- Importar CSVs y revisar:
  - Tablas de posiciones, transferencias y dividendos (diario/por activo).
  - Gráfico de caja/flujo.
- Persistencia:
  - Recargar y verificar que los datos se mantienen vía `persistence.js`.
  - Limpiar estado con `localStorage.removeItem('portfolioDB')` en la consola.
- Precios: probar algunos tickers y revisar CORS/HTTPS.

No hay framework de tests por ahora.

## Persistencia y Datos

- Base en memoria (SQL.js) + snapshot en `localStorage` bajo la clave `portfolioDB`.
- `portafolio-dividendos.csv` es solo para pruebas locales; no usar datos reales.

## Seguridad y Configuración

- No subir secretos ni datos personales. `.env` solo local.
- Producción sobre HTTPS; ajustar CORS al añadir nuevas fuentes.

## Commits y Pull Requests

- Commits: mensaje corto en presente imperativo. Ejemplos:
  - "Add dividend import and tabs"
  - "Permitir múltiples CSV de transferencias"
  - "Registrar dividendos únicos por ActionID"
- PRs:
  - Propósito y cambios clave.
  - Pasos de prueba (CSV usado) y capturas si hay cambios de UI.
  - Enlazar issues y mantener alcance acotado.

## Extensiones y Nuevos Módulos

- Nuevas utilidades: crear archivos descriptivos (p. ej. `utils.js`, `charts.js`) y cargarlos en `index.html`.
- Nuevas fuentes de datos: funciones de fetch/parseo en `logic.js` y esquema/consultas en `persistence.js`.
- Nuevos gráficos/tablas: preparar datasets en `logic.js` y renderizar con Chart.js/DOM.

## FAQ

- ¿Cómo reseteo el estado?
  - `localStorage.removeItem('portfolioDB')` y recargar.
- ¿Dónde agrego una nueva columna?
  - Actualiza el esquema en `persistence.js` y el parseo en `logic.js`.
- ¿Cómo probar precios sin afectar producción?
  - Usar fuente pública en HTTPS. Si requiere clave, guardarla en `.env` (no subir).

