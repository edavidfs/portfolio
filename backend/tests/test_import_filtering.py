import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Añadir raíz del backend al sys.path
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
  sys.path.insert(0, str(BACKEND_ROOT))

from api.main import app, ensure_db_ready, get_connection, ensure_schema  # noqa: E402


@pytest.fixture()
def temp_db(monkeypatch):
  with tempfile.TemporaryDirectory() as tmpdir:
    db_path = os.path.join(tmpdir, "test.db")
    monkeypatch.setenv("PORTFOLIO_DB_PATH", db_path)
    ensure_db_ready()
    yield db_path


def test_import_transfers_filters_stk_and_keeps_opt(temp_db):
  """
  Cobertura: REQ-BK-0013
  Verifica que /import/transfers ignora operaciones STK y OPT, y mantiene FX internas.
  """
  client = TestClient(app)
  payload = {
    "rows": [
      {"TransactionID": "STK:1", "CurrencyPrimary": "EUR", "DateTime": "2024-01-01", "Amount": 100, "AssetClass": "STK"},
      {"TransactionID": "OPT:1", "CurrencyPrimary": "USD", "DateTime": "2024-01-02", "Amount": 50, "AssetClass": "OPT"},
      {"TransactionID": "FX:EUR.USD:1", "CurrencyPrimary": "EUR", "DateTime": "2024-01-03", "Amount": -100, "AssetClass": "CASH"},
    ]
  }
  resp = client.post('/import/transfers', json=payload)
  assert resp.status_code == 200

  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    cur = conn.execute("SELECT transaction_id, origin, kind FROM transfers ORDER BY transaction_id")
    rows = cur.fetchall()
  finally:
    conn.close()

  ids = [r[0] for r in rows]
  assert "STK:1" not in ids  # debe ignorarse
  assert "OPT:1" not in ids  # no deben guardarse en transfers
  assert any(r[0] == "FX:EUR.USD:1" and r[1] == "fx_interno" for r in rows)


def test_import_trades_persists_opt(temp_db):
  """
  Cobertura: REQ-BK-0013
  Verifica que /import/trades guarda filas OPT en trades.
  """
  client = TestClient(app)
  payload = {
    "rows": [
      {"TradeID": "OPT-1", "Ticker": "AAPL", "Quantity": 1, "PurchasePrice": 2.5, "DateTime": "2024-01-10", "CurrencyPrimary": "USD", "Commission": 1, "CommissionCurrency": "USD", "AssetClass": "OPT"}
    ]
  }
  resp = client.post('/import/trades', json=payload)
  assert resp.status_code == 200

  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    cur = conn.execute("SELECT trade_id, asset_class FROM trades")
    rows = cur.fetchall()
  finally:
    conn.close()

  assert rows and rows[0][0] == 'OPT-1'
  assert rows[0][1] == 'OPT'
