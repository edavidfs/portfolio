import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
  sys.path.insert(0, str(BACKEND_ROOT))

from api.main import app, ensure_db_ready  # noqa: E402

test_payload = {
  "rows": [
    {
      "TradeID": "OPT-1",
      "Ticker": "AAPL",
      "Quantity": 1,
      "PurchasePrice": 2.5,
      "DateTime": "2024-01-10T00:00:00",
      "CurrencyPrimary": "USD",
      "Commission": 1.0,
      "CommissionCurrency": "USD",
      "AssetClass": "OPT",
      "raw_json": "{}"
    }
  ]
}


@pytest.fixture()
def temp_db(monkeypatch):
  with tempfile.TemporaryDirectory() as tmpdir:
    db_path = os.path.join(tmpdir, "test.db")
    monkeypatch.setenv("PORTFOLIO_DB_PATH", db_path)
    ensure_db_ready()
    yield db_path


def test_import_and_list_options(temp_db):
  """
  Cobertura: REQ-BK-0013
  Verifica que una fila OPT se persiste y se expone en /trades con raw_json.
  """
  client = TestClient(app)
  resp = client.post('/import/trades', json=test_payload)
  assert resp.status_code == 200

  resp = client.get('/trades')
  assert resp.status_code == 200
  rows = resp.json()
  assert any(r.get('asset_class') == 'OPT' for r in rows)
  opt = next(r for r in rows if r.get('asset_class') == 'OPT')
  assert opt['trade_id'] == 'OPT-1'
  assert opt['ticker'] == 'AAPL'
  assert opt.get('raw_json') is not None
