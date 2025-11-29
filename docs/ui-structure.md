# Estructura de UI (A-UI)

Propósito: guiar la definición y construcción de la interfaz en Angular para la app de gestión de portafolios (Tauri).

## Mapa de pantallas
- Dashboard: visión general, KPIs, gráfico de valor vs. benchmark y alertas de datos.
- Importaciones: carga de CSV (operaciones, transferencias, dividendos) con historial y estado.
- Posiciones: tabla consolidada de activos, PnL, pesos y precios actuales.
- Dividendos: histórico y próximos pagos, agregados por día/activo.
- Estadísticas: métricas A-TR (TWR, volatilidad, drawdown, Sharpe/Sortino) y contribuciones por activo/clase.
- Configuración: rutas locales, tasa libre, benchmark y preferencias de moneda/locale.

## Layout por vista (esquema textual)
- Dashboard: Header con filtros (rango fechas, moneda, benchmark); panel de KPIs; gráfico principal línea/area; tabla resumida de posiciones top; sección de alertas (datos faltantes, precios desactualizados).
- Importaciones: columna izquierda con pasos y FAQs; panel central con dropzone/input CSV, selector de tipo de archivo; tabla de historial (fecha, archivo, resultado, filas); toasts para éxito/error.
- Posiciones: filtros arriba (ticker, clase, rango); tabla con columnas configurables (ticker, unidades, precio, valor, PnL, peso); panel lateral opcional con detalles del activo; skeletons/cargando y estados vacíos.
- Dividendos: pestañas diario/por activo; gráfico de barras; tabla de pagos con fecha, ticker, monto, divisa; badge si hay retenciones/fees.
- Estadísticas: tarjetas KPIs; gráfico de valor vs. benchmark con sombreado drawdown; tabla de contribución por activo/clase; controles de tasa libre y rango.
- Configuración: formulario simple con validaciones; selector de ruta local (Tauri); toggles de preferencias; aviso de reinicio si aplica.

## Componentes y jerarquía (ejemplos)
- `dashboard-page`: orquesta filtros, KPIs y gráficos.
- `kpi-card`: muestra valor, variación y tooltip; inputs: `label`, `value`, `delta`, `loading`.
- `time-series-chart`: línea/area con benchmark; inputs: `series[]`, `benchmark?`, `drawdown?`; output: `onRangeSelect`.
- `positions-table`: inputs: `positions[]`, `loading`, `columns`; outputs: `onSelect`, `onSort`.
- `dividends-table`: inputs: `dividends[]`, `groupBy`; output: `onFilterChange`.
- `imports-panel`: inputs: `fileTypes`, `history[]`; outputs: `onUpload(type,file)`.
- `settings-form`: inputs: `defaults`; outputs: `onSave`, `onCancel`.

## Implementación del dashboard (alineado con **REQ-UI-0009**, **REQ-UI-0010**, **REQ-UI-0011**)
- Estructura:
  - Bloque superior: gráfica principal (valor del portafolio) con toggles para mostrar aportes/retiros y % beneficio/pérdida como series adicionales (**REQ-UI-0009**).
  - Bloque intermedio: selector de intervalo debajo de la gráfica (rangos rápidos + rango libre) que actualiza gráfica y KPIs (**REQ-UI-0010**).
  - Bloque inferior: grilla de cajas/tablas con métricas de flujos y PnL (beneficio, beneficio %, transferencias netas, dividendos, PnL de opciones, intereses pagados) (**REQ-UI-0011**).
- Componentes sugeridos:
  - `portfolio-chart`: inputs `series[]`, `transfersSeries?`, `pnlPctSeries?`, flags `showTransfers`, `showPnlPct`, `loading`; outputs `onRangeSelect`.
  - `range-selector`: inputs `currentRange`, `quickRanges`; output `onRangeChange`.
  - `flow-kpi-grid`: inputs `benefit`, `benefitPct`, `transfersNet`, `dividends`, `optionsPnl`, `interestPaid`, `loading`.
- Interacción:
  - Cambiar rango en `range-selector` dispara recálculo y actualiza `portfolio-chart` y `flow-kpi-grid` (consistencia con **REQ-UI-0002** y **REQ-TR-0001**).
  - Toggles en `portfolio-chart` muestran/ocultan curvas sin recarga completa.
- Estados:
  - Loading: skeleton en gráfico y tarjetas de KPIs.
  - Error: banner con retry; vacío: CTA para importar CSV/seleccionar rango válido.
  - Desactualizado: badge si las series o precios están fuera de umbral.

## Requerimientos del dashboard (A-UI con A-PO/A-TR)
- KPIs: valor de cartera, TWR del rango, volatilidad anualizada, drawdown máximo/actual, Sharpe y Sortino (tasa libre configurable), PnL realizado/no realizado, dividendos del periodo.
- Benchmark: mostrar retorno y curva del benchmark elegido en paralelo a la cartera.
- Rangos rápidos: mes actual, YTD, último año completo y desde inicio; los filtros afectan KPIs, gráficos y tablas.
- Gráfico principal: valor de cartera vs. benchmark con sombreado de drawdown; soporte de selección de rango.
- Desglose por vehículo: tabla/resumen de activos (acciones, ETFs, bonos, opciones, efectivo) con peso, PnL y rentabilidad del periodo.
- Movimientos del periodo: totales y recuentos de compras/ventas/dividendos para validar coherencia de flujos.
- Estados: loading con skeletons, vacío con CTA (importar CSV), error con retry; alerta si precios/series están desactualizados.

## Contratos de datos (interfaces UI)
- `PositionView`: `{ ticker, name?, class, units, price, value, pnlAbs, pnlPct, weight, currency, updatedAt }`
- `Kpi`: `{ label, value, delta?, unit?, tooltip?, loading }`
- `TimePoint`: `{ date: string, value: number, benchmark?: number, drawdown?: number }`
- `DividendView`: `{ date, ticker, amount, currency, withholding?, status? }`
- `ImportHistoryItem`: `{ id, filename, kind, rows, status, message?, createdAt }`

## Flujos de usuario clave
- Importar CSV → ver resultado en historial → reflejo en posiciones/dividendos.
- Aplicar filtros (fecha, benchmark, divisa) → actualizar KPIs y gráficos.
- Seleccionar activo en tabla → ver detalle lateral y métricas específicas.
- Ajustar tasa libre/benchmark en Estadísticas → recalcular KPIs/gráfico.
- Configurar ruta local/moneda → guardar y reiniciar vista si aplica.

## Estados y errores
- Cargando: skeletons en tablas/KPIs, spinner en gráficos.
- Vacío: mensajes claros con CTA (ej. “Importa un CSV para ver posiciones”).
- Error: banner/toast con acción de reintento y detalles mínimos (código/causa).
- Desactualizado: badge/alerta si precios o series son antiguas.

## Guías de estilo rápidas
- Tipografía consistente (ej. familia definida en tema Angular), jerarquía H1-H3, 8pt spacing.
- Paleta con colores para primario, éxito, alerta y acento de datos; usarlos en KPIs y gráficos.
- Responsive: columnas colapsan a tarjetas en móvil; filtros en acordeón.
- Accesibilidad: foco visible, `aria-label` en inputs/tabla, contraste suficiente, soporte de teclado en filtros/tablas.

## Validación UI
- Casos probados por vista: estado feliz, vacío, error, y dataset pequeño conocido.
- Capturas o gifs breves por PR para cambios de UI; anotar comandos usados (`ng test`, `ng serve`) y CSV de ejemplo.
