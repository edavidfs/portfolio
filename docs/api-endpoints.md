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
