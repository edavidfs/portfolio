## Guía de Desarrollo

Esta guía resume la estructura actual (Angular + Tauri), el flujo de la aplicación y las prácticas recomendadas. Todo se mantiene en castellano: código, comentarios y comunicación.

## Estructura del Repositorio

- `frontend/`: aplicación Angular (componentes, servicios, estilos y tests). Ejecuta `npm install`, `npm start`, `ng build`, etc.
- `src-tauri/`: proyecto Rust con la envoltura Tauri. Aquí se configuran ventanas, permisos y comandos previos al build.
- `portafolio-*.csv`: datos de ejemplo para validar importaciones.
- `.env`: variables locales (no subir).
- `.gitignore`: exclusiones comunes (dist, node_modules, target, etc.).

## Flujo de la Aplicación

1. Los componentes de importación (`frontend/src/app/components/imports-view`) leen los CSV mediante Papa Parse.
2. `DataService` (en `frontend/src/app/services/data.service.ts`) sanitiza filas, deduplica, convierte operaciones en flujos (STK/FX/OPT) y persiste en SQL.js (snapshot en `localStorage`).
3. El servicio expone señales (`signal`) para trades, transferencias, dividendos y opciones. El resto de componentes se suscriben para renderizar tablas/gráficos.
4. Las gráficas (cash, posiciones, primas de opciones) usan Chart.js y se alimentan de las agregaciones calculadas en el servicio.
5. Las peticiones de precios (Alpha Vantage/Finnhub) también se orquestan desde `DataService`.
6. Tauri solo envuelve la UI Angular por ahora; más adelante se moverá la lógica pesada a Python/Rust.

## Desarrollo Local

1. Requisitos: Node 18+, npm, Rust (para Tauri) y `cargo`.
2. Instalar dependencias frontend: `npm install` dentro de `frontend/` (también disponible como `just install_dev` desde la raíz).
   - Si todavía no tienes la CLI nativa de Tauri, ejecuta `just install_tauri` (o `just install_all` para dejar todo listo). Requiere que Rust y `cargo` estén instalados.
3. Servir la UI web: `npm start` en `frontend/` y abrir `http://localhost:4200/`.
4. Ejecutar el wrapper de escritorio: `cd src-tauri && cargo tauri dev` (o `just dev`). Este comando levanta `ng serve` automáticamente gracias a `beforeDevCommand` y abre la ventana Tauri.
5. Build Angular standalone: `npm run build` dentro de `frontend/` (resulta en `frontend/dist/ng-portfolio`).
6. Build binarios Tauri: `cd src-tauri && cargo tauri build`.
   - Alternativa: con [`just`](https://github.com/casey/just) puedes ejecutar `just build`, que compila Angular y luego empaqueta Tauri de forma secuencial.

## Dependencias

- Angular 17 (componentes standalone, Signals).
- Chart.js para gráficos.
- SQL.js para persistencia en memoria + snapshot.
- Papa Parse para lectura de CSV.
- `@tauri-apps/api` para futuras integraciones nativas.

Chart.js, SQL.js y Papa Parse siguen entrando vía CDN en `frontend/src/index.html`. Mantén versiones fijas.

## Estilo de Código

- TypeScript con sangría de 2 espacios.
- `const`/`let`, `===`, funciones pequeñas/puras.
- Componentes standalone, servicios inyectables y señales para estado reactivo.
- Nombres `camelCase` para variables/funciones y `PascalCase` para clases/componentes.
- Código y documentación siempre en castellano.

## Pruebas Manuales

- Importar CSVs de transferencias, operaciones y dividendos y comprobar:
  - Tablas (posiciones, transferencias, dividendos).
  - Gráficos de efectivo y primas de opciones.
- Persistencia:
  - Recargar la app (web o Tauri) y verificar que los datos siguen gracias al snapshot SQL.js.
  - Reset: botón de la UI o `localStorage.removeItem('portfolioDB')`.
- Precios: probar algunos tickers y confirmar refresco/avisos de error.

No hay framework de tests automatizados por ahora.

## Persistencia y Datos

- SQL.js almacena trades, transferencias, dividendos, opciones y precios en memoria.
- Tras cada importación se serializa la DB a `localStorage` (`portfolioDB`).
- Al iniciar se intenta restaurar ese snapshot; si no existe, se crea una DB nueva.
- Las claves/API (Alpha/Finnhub) también se guardan en `localStorage`.

## Seguridad y Configuración

- No comprometas secretos ni datos reales. `.env` es solo local.
- Tauri usa HTTPS interno para cargar recursos de CDN. Mantén cuidado con CORS al añadir nuevas fuentes.
- Producción: servir dist Angular sobre HTTPS o empaquetar con Tauri.

## Commits y Pull Requests

- Commits en presente imperativo y en castellano (p. ej. "Añadir importación de dividendos").
- PRs: propósito, cambios clave, pasos de prueba (csv usado) y capturas si afecta a la UI. Alcance acotado.

## Extensiones y Nuevos Módulos

- Nuevos componentes Angular: crear carpeta en `frontend/src/app/components` y declararlos como standalone.
- Nuevos servicios/utilidades: `frontend/src/app/services` o `frontend/src/app/utils`.
- Integración nativa (Tauri): definir comandos en `src-tauri/src/main.rs` y consumirlos desde `@tauri-apps/api`.

## FAQ

- ¿Cómo reseteo el estado?
  - Botón "Reset" o `localStorage.removeItem('portfolioDB')`.
- ¿Dónde agrego una nueva columna o entidad?
  - Actualiza el esquema en `DataService` + SQL.js y ajusta los componentes que consumen esos datos.
- ¿Cómo ejecuto en escritorio?
  - `npm --prefix frontend run tauri -- dev` para desarrollo o `npm --prefix frontend run tauri -- build` para binarios.
