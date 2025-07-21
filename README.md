# Portfolio

Aplicación web sencilla para gestionar un portfolio de inversión. Se puede importar la información desde varios CSV independientes:

- Transferencias a la cuenta.
- Operaciones de compra/venta de acciones. Las columnas no necesarias son ignoradas.
- Dividendos recibidos.
- Opciones negociadas.

La interfaz está construida con **Tailwind CSS** y muestra:

- Una barra superior con el nombre de la aplicación.
- Una gráfica con el efectivo disponible en cada moneda a partir del CSV de transferencias.
- Una tabla con los datos de cada posición: cantidad, precio de compra, precio actual, porcentaje y beneficio.

Para usarla abre `index.html` en un navegador con conexión a Internet y selecciona los archivos CSV correspondientes. Por ahora el gráfico solo utiliza el archivo de transferencias y la tabla se alimenta de las operaciones de acciones.

### Formato del CSV de transferencias

El archivo debe estar separado por `;` y contener como mínimo las columnas. Cualquier otra columna adicional se ignora automáticamente:

- `CurrencyPrimary`: moneda de la transferencia.
- `Date/Time`: fecha de la operación.
- `Amount`: cantidad transferida. Los valores positivos son ingresos y los negativos retiradas.

### Formato del CSV de operaciones de acciones

El archivo debe incluir al menos las columnas `Ticker`, `Quantity` y `PurchasePrice` (o nombres equivalentes). Cualquier otra columna se ignora.
