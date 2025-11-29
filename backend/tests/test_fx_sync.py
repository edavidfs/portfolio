import sys
from datetime import date
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
  sys.path.insert(0, str(BACKEND_ROOT))

from api.main import ensure_schema, get_connection  # noqa: E402
from fx import sync_fx_for_currencies  # noqa: E402


def test_sync_fx_inserts_rows(monkeypatch, tmp_path):
  conn = get_connection(str(tmp_path / "test.db"))
  ensure_schema(conn)
  # moneda base EUR, quote USD
  conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("T1", "USD", "2024-01-01", 100, "externo", "deposito"))
  conn.commit()

  calls = []

  def fake_fetch(symbol, start, end):
    calls.append((symbol, start, end))
    return [(date(2024, 1, 1), 0.9), (date(2024, 1, 2), 0.91)]

  monkeypatch.setattr("fx._fetch_yahoo_fx_history", fake_fetch)
  summary = sync_fx_for_currencies(conn, "EUR", ["USD"])
  assert summary.get("EUR/USD") == 2
  cur = conn.execute("SELECT COUNT(*) FROM fx_rates WHERE base_currency='EUR' AND quote_currency='USD'")
  assert cur.fetchone()[0] == 2
  assert calls
