# Portfolio

Aplicación web sencilla para gestionar un portfolio de inversión. Se puede importar la información desde varios CSV independientes:

- Transferencias a la cuenta.
- Operaciones de compra/venta de acciones. Las columnas no necesarias son ignoradas.
- Dividendos recibidos.
- Opciones negociadas.

La interfaz está construida con **Tailwind CSS** y muestra:

- Una barra superior con el nombre de la aplicación.
- Una gráfica que muestra la evolución temporal del efectivo por moneda combinando transferencias y dividendos.
- Un sistema de pestañas con tablas que detallan por separado transferencias, dividendos y más activos en el futuro.
- Una tabla con los datos de cada posición: cantidad, precio de compra, precio actual, porcentaje y beneficio.
- En la pestaña de dividendos se muestran además los totales diarios y un resumen acumulado por activo.
- Solo se registran dividendos cuyo `Code` sea `Po`. El campo `ActionID` evita duplicados, `GrossAmount` indica el importe bruto y `Tax` la retención asociada al país `IssuerCountryCode`.

Para usarla abre `index.html` en un navegador con conexión a Internet y selecciona los archivos CSV correspondientes. Se pueden cargar varios ficheros de transferencias y solo se registrarán aquellas cuyo `TransactionID` sea único. La gráfica de efectivo combina el historial de transferencias y los dividendos, mientras que la tabla de posiciones se alimenta de las operaciones de acciones.

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
