# Portfolio

Aplicación web sencilla para gestionar un portfolio de inversión. Se puede importar la información desde varios CSV independientes:

- Transferencias a la cuenta.
- Operaciones de compra/venta de acciones.
- Dividendos recibidos.
- Opciones negociadas.

La interfaz está construida con **Tailwind CSS** y muestra:

- Una barra superior con el nombre de la aplicación.
- Una gráfica con el valor actual de cada acción.
- Una tabla con los datos de cada posición: cantidad, precio de compra, precio actual, porcentaje y beneficio.

Para usarla abre `index.html` en un navegador con conexión a Internet y selecciona los archivos CSV correspondientes. Por ahora solo el archivo de operaciones de acciones se usa para calcular las posiciones.
