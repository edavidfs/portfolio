import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  row_index INTEGER NOT NULL,
  data TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL,
  datetime TEXT NOT NULL,
  amount REAL NOT NULL,
  origin TEXT DEFAULT 'externo',
  kind TEXT DEFAULT 'desconocido',
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_transfers_currency ON transfers(currency);
CREATE INDEX IF NOT EXISTS idx_transfers_datetime ON transfers(datetime);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL UNIQUE,
  ticker TEXT,
  quantity REAL,
  purchase REAL,
  datetime TEXT,
  commission REAL,
  commission_currency TEXT,
  currency TEXT,
  isin TEXT,
  asset_class TEXT,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);
CREATE INDEX IF NOT EXISTS idx_trades_datetime ON trades(datetime);

CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL NOT NULL,
  provisional INTEGER DEFAULT 0,
  UNIQUE(ticker, date)
);

CREATE INDEX IF NOT EXISTS idx_prices_ticker ON prices(ticker);
CREATE INDEX IF NOT EXISTS idx_prices_date ON prices(date);

CREATE TABLE IF NOT EXISTS dividends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL UNIQUE,
  ticker TEXT,
  currency TEXT NOT NULL,
  datetime TEXT NOT NULL,
  amount REAL NOT NULL,
  gross REAL,
  tax REAL,
  issuer_country TEXT,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_dividends_currency ON dividends(currency);
CREATE INDEX IF NOT EXISTS idx_dividends_datetime ON dividends(datetime);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fx_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  date TEXT NOT NULL,
  rate REAL NOT NULL,
  UNIQUE(base_currency, quote_currency, date)
);

CREATE INDEX IF NOT EXISTS idx_fx_base_quote ON fx_rates(base_currency, quote_currency);
"""


def get_connection(db_path: str) -> sqlite3.Connection:
  conn = sqlite3.connect(db_path)
  conn.execute("PRAGMA foreign_keys = ON;")
  conn.execute("PRAGMA journal_mode = WAL;")
  conn.execute("PRAGMA synchronous = NORMAL;")
  return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
  conn.executescript(SCHEMA)
  # Migraciones ligeras: asegurar columnas origin/kind en transfers
  cur = conn.execute("PRAGMA table_info(transfers);")
  cols = {row[1] for row in cur.fetchall()}
  if "origin" not in cols:
    conn.execute("ALTER TABLE transfers ADD COLUMN origin TEXT DEFAULT 'externo';")
  if "kind" not in cols:
    conn.execute("ALTER TABLE transfers ADD COLUMN kind TEXT DEFAULT 'desconocido';")
  # Asegurar tabla fx_rates (idempotente)
  conn.execute("""
  CREATE TABLE IF NOT EXISTS fx_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_currency TEXT NOT NULL,
    quote_currency TEXT NOT NULL,
    date TEXT NOT NULL,
    rate REAL NOT NULL,
    UNIQUE(base_currency, quote_currency, date)
  );
  """)
  conn.execute("CREATE INDEX IF NOT EXISTS idx_fx_base_quote ON fx_rates(base_currency, quote_currency);")
  conn.commit()
