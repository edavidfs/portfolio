import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
  sys.path.insert(0, str(BACKEND_ROOT))

from api.main import app, ensure_db_ready, get_connection, ensure_schema  # noqa: E402


def insert_sample_trades(client: TestClient):
  payload = {
    "rows": [
      {"TradeID": "STK-1", "Ticker": "AAPL", "Quantity": 10, "PurchasePrice": 100, "DateTime": "2024-01-10", "CurrencyPrimary": "USD", "AssetClass": "STK"},
      {"TradeID": "OPT-1", "Ticker": "AAPL", "Quantity": -1, "PurchasePrice": 2.5, "DateTime": "2024-01-11", "CurrencyPrimary": "USD", "AssetClass": "OPT", "Side": "SELL", "contracts": 1, "multiplier": 100, "premiumGross": 250},
      {"TradeID": "FX-1", "Ticker": "EUR.USD", "Quantity": 300, "PurchasePrice": 1.1, "DateTime": "2024-01-12", "CurrencyPrimary": "EUR", "AssetClass": "CASH"}
    ]
  }
  return client.post('/import/trades', json=payload)


@pytest.fixture()
def temp_db(monkeypatch):
  with tempfile.TemporaryDirectory() as tmpdir:
    db_path = os.path.join(tmpdir, "test.db")
    monkeypatch.setenv("PORTFOLIO_DB_PATH", db_path)
    ensure_db_ready()
    yield db_path


def test_import_trades_persists_stk_opt_fx(temp_db):
  """
  Cobertura: REQ-BK-0014
  Verifica que /import/trades guarda STK y OPT en trades, y no persiste FX.
  """
  client = TestClient(app)
  resp = insert_sample_trades(client)
  assert resp.status_code == 200

  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    cur = conn.execute("SELECT asset_class, COUNT(*) FROM trades GROUP BY asset_class")
    by_class = {row[0]: row[1] for row in cur.fetchall()}
  finally:
    conn.close()

  assert by_class.get('STK') == 1
  assert by_class.get('OPT') == 1
  assert 'CASH' not in by_class

  # FX debe aparecer en transfers como fx_interno
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    cur = conn.execute("SELECT transaction_id, origin FROM transfers WHERE transaction_id = 'FX-1'")
    row = cur.fetchone()
  finally:
    conn.close()
  assert row is not None
  assert row[1] == 'fx_interno'


def test_trades_endpoint_returns_raw_json(temp_db):
  """
  Cobertura: REQ-BK-0014
  Verifica que /trades expone asset_class y raw_json.
  """
  client = TestClient(app)
  resp = insert_sample_trades(client)
  assert resp.status_code == 200

  resp = client.get('/trades')
  assert resp.status_code == 200
  rows = resp.json()
  assert any(r.get('asset_class') == 'OPT' and r.get('raw_json') is not None for r in rows)
