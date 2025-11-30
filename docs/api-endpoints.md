# Endpoints del backend

- `GET /health`: estado básico.
- `POST /import/transfers`: recibe filas de transferencias (JSON) y las almacena en SQLite.
- `POST /import/trades`: recibe operaciones (JSON) y las almacena.
- `POST /import/dividends`: recibe dividendos (JSON) y los almacena.
- `GET /transfers`: lista transferencias con `transaction_id`, `currency`, `datetime`, `amount`, `origin`, `kind`.
- `GET /cash/net-transfers`: suma aportes/retiros externos por rango (`from_date`, `to_date`) y moneda base; filtra `origin='externo'`.
- `GET /trades`: lista operaciones.
- `POST /prices/sync`: sincroniza precios de tickers con Yahoo.
- `POST /prices/latest`: devuelve último precio por ticker.
- `GET /prices/{ticker}`: serie histórica del ticker.
- `GET /dividends`: lista dividendos.
- `GET /config`: devuelve configuración actual (moneda base).
- `POST /config/base-currency`: actualiza moneda base.
- `POST /fx/rate`: guarda/actualiza un tipo de cambio diario (base, quote, rate, fecha opcional).
- `GET /portfolio/value`: devuelve valor total del portafolio (efectivo + posiciones) en moneda base con desglose.
- `GET /transfers/series`: serie temporal de transferencias por divisa (sin conversión FX).
- `GET /cash/balance`: balance por divisa (transferencias + dividendos, sin FX).
- `GET /cash/series`: serie temporal de efectivo por divisa (transferencias + dividendos, sin FX).
- `POST /import/trades`: importa filas crudas de operaciones y las clasifica/persiste en trades (STK/OPT/FX).
- `POST /import/transfers`: importa filas crudas de transferencias/FX y las persiste en transfers.

## Flujos (Mermaid)

### GET /health

Descripción: endpoint de chequeo rápido que confirma que FastAPI responde y la base SQLite es accesible. Se invoca al cargar la app o al abrir la ventana de Tauri para verificar disponibilidad.

```mermaid
sequenceDiagram
    participant U as Usuario (UI Angular/Tauri)
    participant F as Frontend (fetch)
    participant B as Backend FastAPI
    participant DB as SQLite (estado)

    U->>F: Navega a la app / acción inicial
    F->>B: GET /health
    B->>DB: Lee estado básico/versión
    DB-->>B: OK
    B-->>F: 200 { status: "ok" }
    F-->>U: Muestra app lista / alerta si falla
```

### GET /transfers

Descripción: devuelve la lista de transferencias normalizadas con `transaction_id`, `currency`, `datetime`, `amount`, `origin`, `kind`. Usado por la UI para tablas y cálculo de aportes/retiros. Puede filtrarse en frontend por rango y origen.

```mermaid
sequenceDiagram
    participant U as Usuario (UI)
    participant UI as Frontend Angular
    participant B as Backend FastAPI
    participant DB as SQLite

    U->>UI: Abre vista de Transferencias / dashboard
    UI->>B: GET /transfers
    B->>DB: Consulta tabla transfers
    DB-->>B: Filas normalizadas
    B-->>UI: 200 [ {transaction_id, datetime, amount, currency, origin, kind} ]
    UI-->>U: Muestra tabla, totales y estado de carga
```

### GET /transfers/series

Descripción: devuelve serie temporal de transferencias por divisa sin convertir FX, acumulando transferencias externas e internas; el backend agrega por día o mes y devuelve el acumulado por divisa.

```mermaid
sequenceDiagram
    participant U as Usuario (UI)
    participant UI as Frontend Angular
    participant B as Backend FastAPI
    participant DB as SQLite

    U->>UI: Abre vista de Transferencias (gráfico)
    UI->>B: GET /transfers/series?interval=day
    B->>DB: Lee transfers (currency, datetime, amount, origin)
    B-->>UI: 200 { interval, series: { CUR: [{date, amount, cumulative}] } }
    UI-->>U: Renderiza evolución por divisa (líneas) sin conversión FX
```

### GET /cash/series

Descripción: devuelve serie temporal de efectivo por divisa sin convertir FX, sumando transferencias (externas e internas) y dividendos; agrega por día o mes e incluye acumulado.

```mermaid
sequenceDiagram
    participant UI as Frontend Angular
    participant B as Backend FastAPI
    participant DB as SQLite

    UI->>B: GET /cash/series?interval=day
    B->>DB: Agrega transfers + dividends por fecha y divisa
    DB-->>B: Serie agrupada
    B-->>UI: 200 { interval, series: { CUR: [{date, amount, cumulative}] } }
    UI-->>UI: Muestra evolución de efectivo por divisa
```

### POST /import/trades

Descripción: recibe filas crudas del CSV de operaciones y las clasifica en backend; persiste compras/ventas STK, primas/asignaciones de opciones (OPT) y movimientos FX/cash en `trades` con `asset_class` y `raw_json` intacto.

```mermaid
sequenceDiagram
    participant UI as Frontend Angular
    participant B as Backend FastAPI
    participant DB as SQLite

    UI->>B: POST /import/trades (filas CSV crudas)
    B->>DB: Inserta en trades con asset_class STK/OPT/FX, guarda raw_json
    B-->>UI: 200 { status: "ok", rows: n }
    UI->>B: GET /trades
    B-->>UI: 200 [ { trade_id, asset_class, raw_json, ... } ]
    UI-->>UI: Filtra y consume según tipo (sin procesar en frontend)
```

### POST /import/transfers

Descripción: recibe filas crudas de transferencias y FX (CSV) y las normaliza en el backend, guardándolas en la tabla `transfers` con `origin/kind` y `raw_json`. Ignora operaciones STK/OPT; FX internas se marcan como `fx_interno`.

```mermaid
sequenceDiagram
    participant UI as Frontend Angular
    participant B as Backend FastAPI
    participant DB as SQLite

    UI->>B: POST /import/transfers (filas CSV crudas)
    B->>DB: Inserta en transfers con origin/kind deducidos, guarda raw_json
    B-->>UI: 200 { status: "ok", rows: n }
    UI->>B: GET /transfers
    B-->>UI: 200 [ { transaction_id, currency, datetime, amount, origin, kind } ]
    UI-->>UI: Muestra tabla/series sin procesar en frontend
```

Flujo de arranque con bloqueo de acciones (REQ-UI-0020):

```mermaid
sequenceDiagram
    participant U as Usuario
    participant UI as UI Angular/Tauri
    participant B as Backend FastAPI

    U->>UI: Abre la aplicación
    UI->>UI: Deshabilita acciones que requieren backend
    UI->>B: GET /health
    alt Respuesta OK
        B-->>UI: 200 { status: "ok" }
        UI->>UI: Habilita acciones y oculta alerta
    else Error/timeout
        B-->>UI: Error
        UI-->>U: Muestra alerta y botón "Reintentar"
        U->>UI: Clic en "Reintentar"
        UI->>B: Reintenta GET /health
    end
```

### GET /cash/balance

Descripción: devuelve el balance por divisa sin convertir FX, sumando transferencias (externas e internas) y dividendos; no incluye valoración de posiciones.

```mermaid
sequenceDiagram
    participant UI as Frontend Angular
    participant B as Backend FastAPI
    participant DB as SQLite

    UI->>B: GET /cash/balance
    B->>DB: Agrega transfers y dividends por currency
    DB-->>B: Totales por divisa
    B-->>UI: 200 { balances: [{currency, balance}] }
    UI-->>UI: Muestra balance por cuenta/divisa
```
