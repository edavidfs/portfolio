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
"""


def get_connection(db_path: str) -> sqlite3.Connection:
  conn = sqlite3.connect(db_path)
  conn.execute("PRAGMA foreign_keys = ON;")
  conn.execute("PRAGMA journal_mode = WAL;")
  conn.execute("PRAGMA synchronous = NORMAL;")
  return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
  conn.executescript(SCHEMA)
  conn.commit()
