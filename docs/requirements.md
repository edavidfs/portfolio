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

## UI básica
- Gráfico de línea: valor de cartera vs. benchmark con sombreado de drawdowns.
- Tarjetas de KPIs: TWR periodo, volatilidad, Sharpe/Sortino, PnL realizado/no realizado, dividendos.
- Tabla por activo: peso medio, PnL, rentabilidad y contribución al total.
- Controles: selector de rango de fechas y tasa libre; aviso cuando falten datos de benchmark.

## Validación
- Comparar métricas con un dataset pequeño conocido (CSV de ejemplo) y recalcular con planilla para validar fórmulas.
- Probar escenarios edge: días sin operaciones, faltan precios, dividendos en efectivo, comisiones elevadas.
- Documentar supuestos y fórmulas usadas (anualización, manejo de días sin precios, definición de drawdown).
