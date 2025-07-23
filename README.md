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

Para usarla abre `index.html` en un navegador con conexión a Internet y selecciona los archivos CSV correspondientes. Se pueden cargar varios ficheros de transferencias y solo se registrarán aquellas cuyo `TransactionID` sea único. La gráfica de efectivo combina el historial de transferencias y los dividendos, mientras que la tabla de posiciones se alimenta de las operaciones de acciones.

### Formato del CSV de transferencias

El archivo debe estar separado por `,` y contener como mínimo las columnas. Cualquier otra columna adicional se ignora automáticamente. El campo `Date/Time` puede venir solo con fecha (`DD/MM/YYYY`) o con fecha y hora separados por `;` (`DD/MM/YYYY;HH:MM:SS`):

- `CurrencyPrimary`: moneda de la transferencia.
- `Date/Time`: fecha de la operación.
- `Amount`: cantidad transferida. Los valores positivos son ingresos y los negativos retiradas.
- `TransactionID`: identificador único de la operación.

### Formato del CSV de operaciones de acciones

El archivo debe incluir al menos las columnas `Ticker`, `Quantity` y `PurchasePrice` (o nombres equivalentes). Cualquier otra columna se ignora.
