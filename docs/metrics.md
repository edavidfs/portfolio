# Métricas básicas de portafolio (A-TR)

Alcance inicial: métricas fundamentales para el dashboard y vistas de detalle. Se asume disponibilidad de series diarias de valor de cartera, benchmark, precios y cashflows (operaciones/dividendos).

## Lista de métricas
- Valor de cartera diario: suma de posiciones valoradas a cierre + caja.
- Retornos diarios y acumulados (TWR): `twr = Π(1 + r_diario) - 1`, retornos diarios ajustados por cashflows.
- Volatilidad anualizada: `vol = stdev(r_diario) * sqrt(252)`.
- Drawdown y drawdown máximo: `dd_t = (valor_t - max_previo) / max_previo`; `max_dd = min(dd_t)`.
- Sharpe: `(ret_anualizado - rf) / vol`, con `rf` configurable.
- Sortino: `(ret_anualizado - rf) / downside_vol`, donde `downside_vol` es la desviación de retornos negativos anualizada.
- PnL realizado y no realizado: realizado por ventas/cierres, no realizado por mark-to-market.
- Dividendos/cupones acumulados: suma de ingresos por fecha y activo.
- Contribución por activo/vehículo: peso promedio, retorno y PnL por clase (acciones, ETFs, bonos, opciones, efectivo).
- Movimientos por tipo: totales y recuentos de compras, ventas y dividendos en el rango activo.

## Entradas de datos
- Operaciones: fecha/hora, ticker, cantidad, precio, moneda, comisiones/fees.
- Precios: cierres diarios por ticker y divisa de presentación.
- Dividendos/cupones: fecha, ticker, monto, moneda, retenciones.
- Configuración: tasa libre (`rf`), benchmark y moneda de presentación.
- Calendario: fechas hábiles para alineación con benchmark y precios.
- Opciones: **no se valoran** en esta fase; se consideran posiciones con valor cero y sólo afectan caja vía primas pagadas/cobradas.

## Supuestos de cálculo
- Timezone unificado (UTC) para agrupar en día.
- Cashflows (operaciones/dividendos/fees) se aplican a la caja; retornos diarios para TWR no incluyen aportes/retiros netos en el numerador.
- Forward-fill sólo para precios, nunca para cashflows; benchmark alineado a fechas hábiles.
- Tasa libre constante (por ahora); futura extensión a serie.

## Salidas esperadas
- Series: valor de cartera diario, retorno diario, drawdown, benchmark alineado.
- KPIs: TWR del rango, volatilidad anualizada, max drawdown, Sharpe, Sortino, PnL realizado/no realizado, dividendos acumulados.
- Tablas: por activo y por vehículo con peso, retorno y PnL; movimientos agregados por tipo.

## Verificación
- Dataset de prueba pequeño con resultados calculados en planilla: comparar series y KPIs.
- Casos edge: días sin precios, sólo cash, comisiones altas, dividendos sin posiciones abiertas, rango sin operaciones.
- Tolerancias: métricas porcentuales con diferencia máxima 1e-6 en cálculos deterministas; KPIs derivados (Sharpe/Sortino) permiten tolerancia mayor si hay redondeo de rf.
