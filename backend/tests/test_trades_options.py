import os
import sys
import tempfile
from pathlib import Path

import pytest
from datetime import datetime, timezone

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
  sys.path.insert(0, str(BACKEND_ROOT))

from importer import process_rows, insert_batch, ensure_db  # noqa: E402
from db import get_connection, ensure_schema  # noqa: E402

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
    # asegurar schema
    conn = get_connection(str(db_path))
    ensure_schema(conn)
    conn.close()
    yield db_path


def test_import_and_list_options(temp_db):
  """
  Cobertura: REQ-BK-0013
  Verifica que una fila OPT se persiste y se expone en /trades con raw_json.
  """
  conn = get_connection(str(temp_db))
  ensure_schema(conn)
  now_iso = datetime.now(timezone.utc).isoformat()
  batch_id = insert_batch(conn, "trades", Path("payload"), now_iso)
  rows_cache = list(enumerate(test_payload["rows"]))
  process_rows(conn, batch_id, rows_cache)

  cur = conn.execute("SELECT trade_id, ticker, asset_class, raw_json FROM trades")
  rows = [dict(zip(["trade_id", "ticker", "asset_class", "raw_json"], r)) for r in cur.fetchall()]
  conn.close()

  assert any(r.get('asset_class') == 'OPT' for r in rows)
  opt = next(r for r in rows if r.get('asset_class') == 'OPT')
  assert opt['trade_id'] == 'OPT-1'
  assert opt['ticker'] == 'AAPL'
  assert opt.get('raw_json') is not None
