import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
  sys.path.insert(0, str(BACKEND_ROOT))

from importer import process_rows, insert_batch, ensure_db  # noqa: E402
from db import get_connection, ensure_schema  # noqa: E402


def insert_sample_trades(db_path: str):
  payload = {
    "rows": [
      {"TradeID": "STK-1", "Ticker": "AAPL", "Quantity": 10, "PurchasePrice": 100, "DateTime": "2024-01-10", "CurrencyPrimary": "USD", "AssetClass": "STK"},
      {"TradeID": "OPT-1", "Ticker": "AAPL", "Quantity": -1, "PurchasePrice": 2.5, "DateTime": "2024-01-11", "CurrencyPrimary": "USD", "AssetClass": "OPT", "Side": "SELL", "contracts": 1, "multiplier": 100, "premiumGross": 250},
      {"TradeID": "FX-1", "Ticker": "EUR.USD", "Quantity": 300, "PurchasePrice": 1.1, "DateTime": "2024-01-12", "CurrencyPrimary": "EUR", "AssetClass": "CASH"}
    ]
  }
  conn = get_connection(db_path)
  ensure_schema(conn)
  batch_id = insert_batch(conn, "trades", Path("payload"), "now")
  rows_cache = list(enumerate(payload["rows"]))
  process_rows(conn, batch_id, rows_cache)
  conn.close()
  return True


@pytest.fixture()
def temp_db(monkeypatch):
  with tempfile.TemporaryDirectory() as tmpdir:
    db_path = os.path.join(tmpdir, "test.db")
    monkeypatch.setenv("PORTFOLIO_DB_PATH", db_path)
    conn = ensure_db(Path(db_path))
    conn.close()
    yield db_path


def test_import_trades_persists_stk_opt_fx(temp_db):
  """
  Cobertura: REQ-BK-0014
  Verifica que /import/trades guarda STK y OPT en trades, y las FX se registran como transferencias internas (dos asientos).
  """
  assert insert_sample_trades(temp_db)

  conn = get_connection(str(temp_db))
  ensure_schema(conn)
  try:
    cur = conn.execute("SELECT asset_class, COUNT(*) FROM trades GROUP BY asset_class")
    by_class = {row[0]: row[1] for row in cur.fetchall()}
  finally:
    conn.close()

  assert by_class.get('STK') == 1
  assert by_class.get('OPT') == 1
  assert 'CASH' not in by_class

  # FX debe aparecer en transfers como fx_interno (dos asientos out/in)
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    cur = conn.execute("SELECT transaction_id, origin FROM transfers WHERE transaction_id LIKE 'FX-1%'" )
    rows = cur.fetchall()
  finally:
    conn.close()
  assert len(rows) == 2
  assert all(r[1] == 'fx_interno' for r in rows)


def test_trades_endpoint_returns_raw_json(temp_db):
  """
  Cobertura: REQ-BK-0014
  Verifica que /trades expone asset_class y raw_json.
  """
  assert insert_sample_trades(temp_db)

  conn = get_connection(str(temp_db))
  ensure_schema(conn)
  cur = conn.execute("SELECT asset_class, raw_json FROM trades")
  rows = [dict(zip(["asset_class", "raw_json"], r)) for r in cur.fetchall()]
  conn.close()
  assert any(r.get('asset_class') == 'OPT' and r.get('raw_json') is not None for r in rows)
