import os
import sys
import tempfile
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
  sys.path.insert(0, str(BACKEND_ROOT))

from importer import process_rows, insert_batch, ensure_db  # noqa: E402
from db import get_connection, ensure_schema  # noqa: E402


def test_run_importer_trades_inserts_rows(monkeypatch, tmp_path):
  """
  Cobertura: REQ-BK-0014
  Verifica que run_importer persiste trades STK/OPT y deja los FX fuera de trades.
  """
  db_path = tmp_path / "test.db"
  monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db_path))
  conn = ensure_db(db_path)
  conn.close()

  rows = [
    {"TradeID": "STK-1", "Ticker": "AAPL", "Quantity": 10, "PurchasePrice": 100, "DateTime": "2024-01-10", "CurrencyPrimary": "USD", "AssetClass": "STK"},
    {"TradeID": "OPT-1", "Ticker": "AAPL", "Quantity": -1, "PurchasePrice": 2.5, "DateTime": "2024-01-11", "CurrencyPrimary": "USD", "AssetClass": "OPT", "Side": "SELL", "contracts": 1, "multiplier": 100, "premiumGross": 250},
    {"TradeID": "FX-1", "Ticker": "EUR.USD", "Quantity": 300, "PurchasePrice": 1.1, "DateTime": "2024-01-12", "CurrencyPrimary": "EUR", "AssetClass": "CASH"}
  ]
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  batch_id = insert_batch(conn, "trades", Path("payload"), "now")
  rows_cache = list(enumerate(rows))
  process_rows(conn, batch_id, rows_cache)

  try:
    cur = conn.execute("SELECT asset_class, trade_id FROM trades ORDER BY trade_id")
    results = cur.fetchall()
    asset_classes = [r[0] for r in results]
  finally:
    conn.close()

  assert 'STK' in asset_classes
  assert 'OPT' in asset_classes
  assert all(ac != 'CASH' for ac in asset_classes)


def test_run_importer_transfers_fx_and_ignore_stk(monkeypatch, tmp_path):
  """
  Cobertura: REQ-BK-0014
  Verifica que run_importer con kind=transfers guarda FX en transfers y omite STK/OPT.
  Las FX internas generan dos asientos (out/in).
  """
  db_path = tmp_path / "test.db"
  monkeypatch.setenv("PORTFOLIO_DB_PATH", str(db_path))
  conn = ensure_db(db_path)
  conn.close()

  rows = [
    {"TransactionID": "STK:1", "CurrencyPrimary": "EUR", "DateTime": "2024-01-01", "Amount": 100, "AssetClass": "STK"},
    {"TransactionID": "OPT:1", "CurrencyPrimary": "USD", "DateTime": "2024-01-02", "Amount": 50, "AssetClass": "OPT"},
    {"TransactionID": "FX:EUR.USD:1", "Ticker": "EUR.USD", "CurrencyPrimary": "EUR", "DateTime": "2024-01-03", "Amount": -100, "AssetClass": "CASH"}
  ]
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  batch_id = insert_batch(conn, "transfers", Path("payload"), "now")
  rows_cache = list(enumerate(rows))
  process_rows(conn, batch_id, rows_cache)
  cur = conn.execute("SELECT transaction_id, origin FROM transfers ORDER BY transaction_id")
  results = cur.fetchall()
  conn.close()

  ids = [r[0] for r in results]

  assert "STK:1" not in ids
  assert "OPT:1" not in ids

  assert any(r[0].endswith(":out") and "FX:EUR.USD:1" in r[0] and r[1] == "fx_interno" for r in results)
  assert any(r[0].endswith(":in") and "FX:EUR.USD:1" in r[0] and r[1] == "fx_interno" for r in results)
  assert len(results) == 2
