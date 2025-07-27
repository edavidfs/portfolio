# Portfolio

Aplicación web sencilla para gestionar un portfolio de inversión. Se puede importar la información desde varios CSV independientes:

- Transferencias a la cuenta.
- Operaciones de compra/venta de acciones. Las columnas no necesarias son ignoradas.
- Dividendos recibidos.
- Opciones negociadas.

Los datos importados se almacenan localmente en el navegador mediante una base de datos SQLite gestionada con **sql.js**, por lo que no es necesario volver a cargar los CSV cada vez que se abre la página. El código JavaScript se divide en dos archivos: `db.js` con las funciones de base de datos y `script.js` con el resto de la lógica.

La interfaz está construida con **Tailwind CSS** y muestra:

- Una barra superior con el nombre de la aplicación.
- Una gráfica que muestra la evolución temporal del efectivo por moneda a partir del CSV de transferencias.
- Una tabla con los datos de cada posición: cantidad, precio de compra, precio actual, porcentaje y beneficio.

Para usarla abre `index.html` en un navegador con conexión a Internet y selecciona los archivos CSV correspondientes. La gráfica se genera únicamente con el historial de transferencias y la tabla se alimenta de las operaciones de acciones.

### Formato del CSV de transferencias

El archivo debe estar separado por `,` y contener como mínimo las columnas. Cualquier otra columna adicional se ignora automáticamente. El campo `Date/Time` puede venir solo con fecha (`DD/MM/YYYY`) o con fecha y hora separados por `;` (`DD/MM/YYYY;HH:MM:SS`):

- `CurrencyPrimary`: moneda de la transferencia.
- `Date/Time`: fecha de la operación.
- `Amount`: cantidad transferida. Los valores positivos son ingresos y los negativos retiradas.

### Formato del CSV de operaciones de acciones

El archivo debe incluir al menos las columnas `Ticker`, `Quantity` y `PurchasePrice` (o nombres equivalentes). Cualquier otra columna se ignora.
