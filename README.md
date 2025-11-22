# Portfolio

Aplicación web sencilla para gestionar un portfolio de inversión. Se puede importar la información desde varios CSV independientes:

- Transferencias a la cuenta.
- Operaciones de compra/venta de acciones. Las columnas no necesarias son ignoradas.
- Dividendos recibidos.
- Opciones negociadas.

La interfaz está construida con **Angular + Tailwind CSS** y muestra:

- Una barra superior con el nombre de la aplicación.
- Una gráfica que muestra la evolución temporal del efectivo por moneda combinando transferencias y dividendos.
- Un sistema de pestañas con tablas que detallan por separado transferencias, dividendos y más activos en el futuro.
- Una tabla con los datos de cada posición: cantidad, precio de compra, precio actual, porcentaje y beneficio.
- En la pestaña de dividendos se muestran además los totales diarios y un resumen acumulado por activo.
- Solo se registran dividendos cuyo `Code` sea `Po`. El campo `ActionID` evita duplicados, `GrossAmount` indica el importe bruto y `Tax` la retención asociada al país `IssuerCountryCode`.

## Arquitectura y ejecución

- `frontend/`: aplicación Angular que contiene los componentes, servicios y estilos. Aquí se trabaja el 100 % de la UI.
- `src-tauri/`: envoltorio Tauri (Rust) que empaqueta la UI para escritorio y orquesta el build.
- CSV de ejemplo (`portafolio-dividendos.csv`, etc.) siguen en la raíz para validar importaciones.

### Desarrollo rápido

1. Instalar dependencias del frontend: `npm install` dentro de `frontend/` (o simplemente `just install_dev` desde la raíz).
   - Para preparar la CLI nativa de Tauri (requiere Rust + `cargo`): `just install_tauri`. Si quieres dejar todo listo de una vez, usa `just install_all`.
2. Servir en modo web: `npm start` en `frontend/` y abrir `http://localhost:4200`.
3. Ejecutar versión escritorio: `cd src-tauri && cargo tauri dev` o simplemente `just dev`. Tauri lanzará `ng serve` automáticamente gracias a `beforeDevCommand`.
4. Generar binarios Tauri: `cd src-tauri && cargo tauri build` (o `just build`, que primero ejecuta `npm run build` en `frontend/` y después empaqueta con Tauri). Desde la barra del sistema (menú “Ver → Mostrar DevTools”) puedes abrir las herramientas de desarrollo cuando estés en el wrapper de escritorio.
5. Backend FastAPI (nuevo servicio):
   - Requisitos: [uv](https://github.com/astral-sh/uv) o Python 3.9+.
   - Crear entorno: `uv venv backend/.venv` y luego `source backend/.venv/bin/activate && pip install -r backend/requirements.txt`.
   - (Opcional) Ejecutar servidor manualmente: `just backend` (o `uvicorn backend.api.main:app --reload`). **Nota:** Tauri lo arranca automáticamente al lanzar `just dev`, reutilizando `backend/.venv/bin/python`. Si no quieres ese comportamiento, exporta `PORTFOLIO_NO_BACKEND=1`.
   - Por defecto escucha en `http://127.0.0.1:8000`. Puedes sobrescribir la URL en el frontend definiendo `window.__PORTFOLIO_API__ = 'http://...'` antes de bootstrappedar Angular. La base SQLite se guarda en el directorio de datos del usuario (ej. `~/Library/Application Support/com.portfolio.desktop/portfolio.db`). Para forzar otra ruta, exporta `PORTFOLIO_DB_PATH=/ruta/portfolio.db` antes de arrancar el backend.

El empaquetado de Tauri usa `src-tauri/tauri.conf.json`, donde se define el comando previo de desarrollo (`npm run start --prefix ../frontend`) y la carpeta de salida (`frontend/dist/ng-portfolio`). El build de Angular se ejecuta antes de invocar Tauri (p. ej. al usar `just build`).

Para usarla en modo web, abre `http://localhost:4200` (via `ng serve`) o sirve la carpeta `frontend/dist/ng-portfolio` y selecciona los archivos CSV correspondientes. Se pueden cargar varios ficheros de transferencias y solo se registrarán aquellas cuyo `TransactionID` sea único. La gráfica de efectivo combina el historial de transferencias y los dividendos, mientras que la tabla de posiciones se alimenta de las operaciones de acciones.

### Backend Python + SQLite

- Existe un backend mínimo en `backend/` (scripts `db.py` e `importer.py`). El wrapper Tauri extrae estos ficheros a la carpeta de datos del usuario (`AppData`/`~/Library/Application Support/com.portfolio.desktop/`) y ejecuta `python3 importer.py`.
- Cada importación crea un lote (`import_batches`) y almacena cada fila del CSV como historial (`import_rows`). Para transferencias se normaliza la información en la tabla `transfers`; para operaciones STK se rellenan registros en la tabla `trades`.
- En la app de escritorio (o incluso en el navegador), al seleccionar CSVs de transferencias u operaciones, Angular los parsea y envía las filas al backend FastAPI (JSON). Así no dependemos de rutas ni permisos especiales y todo acaba persistido en SQLite (`portfolio.db`).
- Se requiere tener `python3` disponible en el PATH. Si el backend no está corriendo, la UI mostrará toasts de error al intentar sincronizar/importar.
- La base `portfolio.db` y el log `backend.log` quedan accesibles para copias de seguridad y depuración.

### Servicio FastAPI

- Código en `backend/api/main.py`. Arranca un servidor REST (`uvicorn backend.api.main:app --reload`) con los endpoints:
  - `POST /import/transfers` y `POST /import/trades`: aceptan `{ rows: [] }` y delegan en `importer.py` para persistir.
  - `POST /reset`: elimina `portfolio.db` y reinicia el backend (botón disponible en la pestaña de importaciones).
  - `GET /transfers` y `GET /trades`: devuelven los registros guardados en SQLite.
  - `GET /health`: simple comprobación.
- En la pestaña “Importaciones” hay un botón “Borrar base de datos” que invoca ese endpoint `/reset` y refresca las tablas una vez completado.
- Configuración:
  - `PORTFOLIO_DB_PATH`: (opcional) ruta absoluta del `.db`. Por defecto usa el directorio de datos del usuario (`~/Library/Application Support/com.portfolio.desktop/portfolio.db` en macOS, rutas equivalentes en Windows/Linux). Puedes definirla en un `.env` en la raíz (`PORTFOLIO_DB_PATH=/ruta/custom.db`).
  - En el frontend puedes definir `window.__PORTFOLIO_API__ = 'http://localhost:8000';` antes de bootstrap para apuntar a otra URL.
  - `PORTFOLIO_NO_BACKEND=1`: evita que Tauri lance el backend automáticamente (útil si ya lo estás ejecutando aparte).
- El backend reutiliza `importer.py`, así que las reglas de deduplicación y normalización son idénticas a las del CLI.
- Los logs (`portfolio.log`) se escriben en el mismo directorio que la base de datos (Application Support por defecto).

### Formato del CSV de transferencias

El archivo debe estar separado por `,` y contener como mínimo las columnas. Cualquier otra columna adicional se ignora automáticamente. El campo `Date/Time` puede venir solo con fecha (`DD/MM/YYYY`) o con fecha y hora separados por `;` (`DD/MM/YYYY;HH:MM:SS`):

- `CurrencyPrimary`: moneda de la transferencia.
- `Date/Time`: fecha de la operación.
- `Amount`: cantidad transferida. Los valores positivos son ingresos y los negativos retiradas.
- `TransactionID`: identificador único de la operación.

### Formato del CSV de operaciones de acciones

El archivo debe incluir al menos las columnas `Ticker`, `Quantity` y `PurchasePrice` (o nombres equivalentes). Cualquier otra columna se ignora.

### Formato del CSV de dividendos

Las filas de dividendos deben tener como mínimo los siguientes campos:

- `ActionID`: identificador único de la operación.
- `Code`: debe ser `Po` para que el dividendo se registre.
- `Ticker`: activo sobre el que se reparte el dividendo.
- `CurrencyPrimary`: moneda del pago.
- `Date/Time` o `PaymentDate`: fecha de cobro.
- `GrossAmount`: importe bruto (ingreso más impuesto).
- `Tax`: retención aplicada.
- `IssuerCountryCode`: país de origen del dividendo.

## Contribución

- Guía: consulta `AGENTS.md` (Repository Guidelines) para estructura, estilo y pruebas.
- Idioma: escribir siempre en castellano en código, commits y PRs.
- PRs: incluir propósito, cambios clave, pasos de prueba y capturas si cambia la UI.

## Reglas de deduplicación

Para evitar registros duplicados al reimportar ficheros, la aplicación aplica estas reglas:

- Operaciones de acciones (STK): se prioriza el identificador `IBExecID`/`TradeID`. Si no existe, se usa la clave
  alternativa `Ticker|Quantity|PurchasePrice`.
- Transferencias: se considera único el `TransactionID`.
- Dividendos: se considera único el `ActionID` y solo se registran líneas con `Code = Po`.
- Flujos de efectivo derivados de STK: se generan con ID `STK:{TradeID}` cuando existe; en su defecto
  `STK:{Ticker}:{timestamp}:{qty}:{price}` para evitar colisiones.

## Derivación de efectivo desde acciones (STK → CASH)

Además de las transferencias, la curva de efectivo incorpora los flujos derivados de compras/ventas de acciones:

- Compras: importe negativo igual a `-(Quantity * PurchasePrice)` más la comisión (si la comisión está en la misma divisa
  que la operación). Las comisiones suelen venir con signo negativo; se suman tal cual para reflejar su impacto.
- Ventas: importe positivo igual a `(-Quantity * PurchasePrice)` más la comisión (negativa, resta del neto recibido).
- Divisa: se usa `CurrencyPrimary` de la operación; si la comisión viene en otra divisa, no se añade al flujo.
- Identificadores: ver sección de deduplicación para evitar entradas duplicadas.

### Traspasos entre monedas (FX con AssetClass = CASH)

Cuando el CSV de operaciones incluya cambios de divisa (símbolos tipo `EUR.USD`):

- Se generan dos movimientos: uno en la divisa base (antes del punto) y otro en la divisa cotizada (después del punto).
- `Buy/Sell = Sell`: se venden unidades de la divisa base y se compran unidades de la cotizada.
- `Buy/Sell = Buy`: se compran unidades de la divisa base pagando con la cotizada.
- Cálculo: si `Symbol = EUR.USD`, `Quantity = 700` y `TradePrice = 1.10`, entonces `USD = 700 * 1.10`.
- Signos: salida en la divisa que se entrega (negativo) y entrada en la que se recibe (positivo).
- Comisión: se aplica a la pierna cuya moneda coincide con `IBCommissionCurrency` (suele venir negativa).
- IDs: se generan 2 IDs estables por operación y moneda (`FX:{IBExecID}:{MONEDA}` o clave derivada del símbolo, fecha y precio) para deduplicar correctamente.

## Persistencia y Reset

- Almacenamiento local: los datos se guardan en `localStorage` bajo la clave `portfolioDB` como snapshot de SQL.js.
- Esquema: `persistence.js` gestiona la creación y migración de tablas y persiste tras cada importación.
- Reset: el botón “Reset (borrar datos locales)” borra el snapshot y recarga la página. Manualmente, también puedes
  ejecutar `localStorage.removeItem('portfolioDB')` en la consola del navegador.
- Privacidad: la app no sube información a ningún servidor; todo ocurre en tu navegador.

## Precios y conectividad

- Fuente de precios: se consultan cotizaciones actuales desde Yahoo Finance. Requiere conexión a Internet.
- Fallos de red/CORS: si no se puede obtener el precio de un ticker, se muestra un aviso y se usa `0` temporalmente.
- Cache: los precios se piden en lote por los tickers en cartera en cada refresco de posiciones.

## Monedas y FX

- Gráfico de efectivo: muestra saldos acumulados por moneda; no hay conversión entre divisas.
- Posiciones: el valor actual y los porcentajes se calculan en la moneda de cotización del activo, sin conversión FX.
  Si tu cartera tiene múltiples divisas, interpreta los porcentajes con esta limitación en mente.

## Cargos de interés por margen

Puedes registrar intereses de margen como salidas de efectivo de dos formas, según el CSV que manejes:

- Operaciones `CASH`: incluye una fila con `AssetClass = CASH`, `Quantity`, `TradePrice` y `CurrencyPrimary` tal que
  el producto `Quantity * TradePrice` sea el importe del cargo (generalmente negativo). Se deduplica por `IBExecID` si
  existe, o por clave derivada de símbolo/fecha/importe.
- Transferencias: añade una fila con `Amount` negativo en el CSV de transferencias y `TransactionID` único.

## Formato del CSV de opciones (en preparación)

La aplicación permite cargar CSVs de opciones, pero por ahora no se integran en tablas ni cálculos. Se recomienda el
 siguiente esquema mínimo para futuras integraciones:

- `Underlying`/`Ticker`: subyacente (por ejemplo, `AAPL`).
- `Symbol`: símbolo de la opción (incluyendo vencimiento, strike y derecho si procede).
- `Right`: `C` o `P`.
- `Strike`: precio de ejercicio.
- `Expiry`: fecha de vencimiento.
- `Quantity`: cantidad (contratos, puede ser negativa).
- `TradePrice`/`Price`: precio por contrato.
- `IBCommission` y `IBCommissionCurrency`: comisión y su divisa (opcional).
- `CurrencyPrimary`: divisa principal de la operación.
- `Date/Time`: fecha y hora (`DD/MM/YYYY` o `DD/MM/YYYY;HH:MM:SS`).
- `IBExecID`/`TransactionID`: identificador único para deduplicación.

Estado actual: la carga de opciones se almacena en memoria, pero no impacta aún en posiciones, efectivo o gráficos.
Se añadirá documentación adicional cuando estén integradas (primas, PnL, asignaciones y expiraciones).
