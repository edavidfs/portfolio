# Requisitos A-TR (Trading y Estadística)

Objetivo: habilitar métricas básicas de gestión de cartera que puedan consumirse en UI y API, con cálculos reproducibles y supuestos documentados.

## Métricas mínimas
- Rentabilidad acumulada y por periodo (diaria/mensual) vía TWR; mostrar curva de valor de cartera.
- Volatilidad anualizada y drawdown máximo (basado en series diarias).
- Ratio Sharpe y Sortino (con tasa libre configurable).
- PnL realizado vs. no realizado y dividendos acumulados.
- Rendimiento por activo y por clase de activo (equity/ETF/bono/efectivo).

## Datos necesarios
- Series de valor diario de la cartera (posiciones, precios de cierre y caja).
- Historial de operaciones (fecha, ticker, cantidad, precio, comisiones/fees).
- Historial de dividendos/cupones por fecha y ticker.
- Benchmark opcional (ticker o serie externa) para comparativas.
- Tasa libre (constante o serie) para ratios de riesgo.
- Fuente de datos: archivos CSV exportados de Interactive Brokers (formato actual) como entrada principal de importación.

## Entradas y supuestos de cálculo
- Timezone unificado (UTC recomendado) para agregación diaria.
- Fees/retenciones incluidos en cashflow para PnL y TWR.
- Dividendos reinvertidos en cash salvo indicación contraria.
- Benchmarks deben alinearse en fechas hábiles; rellenar con forward-fill sólo precios, no cashflows.

## API/servicios esperados
- Endpoint/servicio que devuelva series: valor de cartera diario, TWR, drawdown y benchmark.
- Endpoint/servicio de KPIs agregados: volatilidad, Sharpe, Sortino, PnL realizado/no realizado, dividendos.
- Endpoint/servicio por activo/clase: contribución a rentabilidad, PnL y peso promedio.
- Parámetros opcionales: rango de fechas, benchmark, tasa libre y moneda de presentación.

## Requisitos de UI (A-UI, formato ECSS)
- **REQ-UI-0001** (Tipo: Funcional, Estado: Pendiente, Prioridad: Alta)
  - Título: KPIs de desempeño y riesgo.
  - Declaración: La UI debe mostrar en el dashboard tarjetas con valor de cartera, TWR del rango activo, volatilidad anualizada, drawdown máximo y actual, Sharpe, Sortino (tasa libre configurable), PnL realizado/no realizado y dividendos del periodo.
  - Racional/Fuente: Visión unificada de desempeño, riesgo y flujos (A-PO, A-TR, ECSS).
  - Verificación (I/A/T/D): T (prueba manual) + A (comparación contra backend).
  - Criterios de aceptación: 1) Al menos 8 KPIs visibles simultáneamente; 2) Cambiar tasa libre actualiza Sharpe/Sortino sin recarga; 3) Valores coinciden con backend para dataset de prueba.
  - Trazabilidad: Padre: objetivo dashboard A-PO; Relación: consume REQ-TR-0001; Hijos: casos de prueba KPIs.

- **REQ-UI-0002** (Tipo: Funcional, Estado: Pendiente, Prioridad: Alta)
  - Título: Rangos rápidos consistentes.
  - Declaración: La UI debe ofrecer rangos rápidos (mes actual, YTD, último año completo, desde inicio) y aplicar el rango a KPIs, gráficos y tablas del dashboard de forma consistente.
  - Racional/Fuente: Asegurar coherencia temporal en la experiencia de análisis (A-PO, ECSS).
  - Verificación (I/A/T/D): T (prueba manual) + I (inspección de estados).
  - Criterios de aceptación: 1) Cambiar rango actualiza KPIs, gráfico y tablas en <1 s perceptible; 2) No se muestran valores de rangos anteriores tras el cambio.
  - Trazabilidad: Padre: dashboard; Relación: depende de REQ-UI-0001 y REQ-TR-0001.

- **REQ-UI-0003** (Tipo: Funcional, Estado: Pendiente, Prioridad: Alta)
  - Título: Gráfico cartera vs benchmark con drawdown.
  - Declaración: La UI debe mostrar un gráfico con curva de valor de cartera y benchmark en el mismo eje temporal, sombreando drawdowns y permitiendo seleccionar sub-rangos.
  - Racional/Fuente: Comparación relativa y visualización de pérdidas máximas (A-TR, ECSS).
  - Verificación (I/A/T/D): I (inspección) + T (interacción en UI).
  - Criterios de aceptación: 1) Se visualizan ambas curvas alineadas en fechas; 2) El sombreado aparece cuando la cartera está bajo máximo previo; 3) Selección de rango ajusta KPIs asociados.
  - Trazabilidad: Relación: consume series alineadas (REQ-TR-0001); Hijo: componente gráfico.

- **REQ-UI-0004** (Tipo: Funcional, Estado: Pendiente, Prioridad: Alta)
  - Título: Tabla por activo con coherencia de rango.
  - Declaración: La UI debe presentar tabla por activo con ticker, nombre, clase, unidades, precio, valor, PnL absoluto, PnL porcentual, peso y fecha de actualización, filtrados al rango activo.
  - Racional/Fuente: Trazabilidad por activo y conciliación con agregados (A-UI, ECSS).
  - Verificación (I/A/T/D): T (prueba manual) + A (sumas vs KPIs).
  - Criterios de aceptación: 1) Totales de valor/PnL por activo suman al agregado del rango; 2) Pesos suman ~100% con tolerancia <0.5%; 3) Orden y filtros funcionan según rango activo.
  - Trazabilidad: Relación: depende de REQ-UI-0002; Hijos: pruebas de tabla.

- **REQ-UI-0005** (Tipo: Funcional, Estado: Pendiente, Prioridad: Media)
  - Título: Resumen por vehículo.
  - Declaración: La UI debe ofrecer resumen por vehículo (acciones, ETFs, bonos, opciones, efectivo) mostrando peso, PnL y rentabilidad del periodo activo.
  - Racional/Fuente: Entender contribución por tipo de instrumento (A-PO, A-TR).
  - Verificación (I/A/T/D): T (prueba manual con dataset etiquetado).
  - Criterios de aceptación: 1) Cada vehículo muestra peso, PnL y retorno; 2) Suma de pesos coincide con 100% ±0.5%; 3) Totales concuerdan con KPIs.
  - Trazabilidad: Hijo de REQ-UI-0004; depende de clasificación de activos (BK/AR).

- **REQ-UI-0006** (Tipo: Funcional, Estado: Pendiente, Prioridad: Media)
  - Título: Totales de movimientos del periodo.
  - Declaración: La UI debe mostrar totales y recuentos de compras, ventas y dividendos del periodo activo junto a los KPIs.
  - Racional/Fuente: Validar coherencia de flujos vs desempeño (A-PO, A-TR).
  - Verificación (I/A/T/D): T (prueba manual) + A (reconciliación con dataset de ejemplo).
  - Criterios de aceptación: 1) Totales por tipo coinciden con sumatoria de movimientos del rango; 2) Variar el rango actualiza los totales.
  - Trazabilidad: Relación con importadores (BK) y dashboard (UI).

- **REQ-UI-0007** (Tipo: Funcional, Estado: Pendiente, Prioridad: Media)
  - Título: Control de benchmark y tasa libre en UI.
  - Declaración: La UI debe permitir seleccionar benchmark y tasa libre desde el dashboard y reflejar cambios en KPIs y gráfico sin recargar la vista completa.
  - Racional/Fuente: Exploración comparativa fluida (A-TR).
  - Verificación (I/A/T/D): T (prueba interactiva).
  - Criterios de aceptación: 1) Cambio de benchmark actualiza gráfico y KPIs en <1 s perceptible; 2) Cambio de tasa libre recalcula Sharpe/Sortino.
  - Trazabilidad: Relación: depende de REQ-TR-0001 y servicio de precios (BK).

- **REQ-UI-0008** (Tipo: No funcional, Estado: Pendiente, Prioridad: Alta)
  - Título: Gestión de estados y mensajes.
  - Declaración: La UI debe mostrar estados de loading (skeletons/spinners), vacío con CTA de importación, error con acción de reintento y alerta cuando precios/series estén desactualizados.
  - Racional/Fuente: Usabilidad y resiliencia (A-UI, ECSS).
  - Verificación (I/A/T/D): I (inspección) + T (forzar estados en dev).
  - Criterios de aceptación: 1) Cada estado se muestra con mensaje claro y acción; 2) Alertas de datos desactualizados se activan según umbral configurable.
  - Trazabilidad: Aplica a dashboard y vistas de datos; relación con health checks (BK).

## Requisito de alineación de datos (A-TR, formato ECSS)
- **REQ-TR-0001** (Tipo: Integración, Estado: Pendiente, Prioridad: Alta)
  - Título: Alineación de series y KPIs.
  - Declaración: Las series y KPIs consumidos en el dashboard deben alinearse en fechas, aplicar la tasa libre indicada y sincronizar el benchmark sin rellenar cashflows con forward-fill.
  - Racional/Fuente: Comparabilidad de métricas de riesgo y retorno (A-TR, ECSS).
  - Verificación (I/A/T/D): A (comparación de series) + T (pruebas de backend/UI).
  - Criterios de aceptación: 1) Fechas de cartera y benchmark están alineadas sin huecos de cashflows rellenados; 2) Cambio de tasa libre se refleja en KPIs; 3) UI muestra exactamente los valores procesados por backend.
  - Trazabilidad: Padre de REQ-UI-0001/0002/0003/0007; depende de ingestión y servicios de precios (BK).

## Validación
- Comparar métricas con un dataset pequeño conocido (CSV de ejemplo) y recalcular con planilla para validar fórmulas.
- Probar escenarios edge: días sin operaciones, faltan precios, dividendos en efectivo, comisiones elevadas.
- Documentar supuestos y fórmulas usadas (anualización, manejo de días sin precios, definición de drawdown).
