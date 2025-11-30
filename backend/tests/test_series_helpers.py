import os
import sys
import tempfile
from datetime import date
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
  sys.path.insert(0, str(BACKEND_ROOT))

from api.portfolio_service import (  # noqa: E402
  build_buckets,
  build_series_from_buckets,
  build_value_by_date,
  collect_trades_and_cash,
  collect_transfers_and_cash
)
from api.main import ensure_schema, get_connection  # noqa: E402

# Cobertura: REQ-BK-0009 (serie continua), REQ-BK-0006 (series), REQ-BK-0008 (caja sin precios)


@pytest.fixture()
def conn():
  tmp = tempfile.NamedTemporaryFile(delete=False)
  try:
    c = get_connection(tmp.name)
    ensure_schema(c)
    yield c
  finally:
    try:
      c.close()
    except Exception:
      pass
    os.unlink(tmp.name)


def test_collect_transfers_and_cash_only_transfers(conn):
  conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("T1", "EUR", "2024-01-01", 100, "externo", "deposito"))
  conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("T2", "EUR", "2024-01-02", -50, "externo", "retiro"))
  conn.commit()
  transfers, cash = collect_transfers_and_cash(conn, "EUR", {})
  assert transfers[date(2024, 1, 1)] == 100
  assert transfers[date(2024, 1, 2)] == -50
  assert cash[date(2024, 1, 1)]["EUR"] == 100
  # Saldos acumulados por divisa
  assert cash[date(2024, 1, 2)]["EUR"] == 50


def test_build_series_continuous_with_cash(conn):
  # Solo caja, sin trades ni precios
  conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("T1", "EUR", "2024-02-01", 100, "externo", "deposito"))
  conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("T2", "EUR", "2024-02-03", 50, "externo", "deposito"))
  conn.commit()
  transfers, cash_mov = collect_transfers_and_cash(conn, "EUR", {})
  buckets = build_buckets(date(2024, 2, 1), date(2024, 2, 3), "day", {}, transfers, cash_mov)
  series = build_series_from_buckets(conn, buckets, "EUR")
  # 3 días continuos
  assert [pt["date"] for pt in series] == ["2024-02-01", "2024-02-02", "2024-02-03"]
  # Valores de caja arrastrando saldo
  assert series[0]["value_base"] == 100
  assert series[1]["value_base"] == 100
  assert series[2]["value_base"] == 150


def test_build_value_by_date_uses_trade_prices(conn):
  conn.execute("INSERT INTO fx_rates(base_currency, quote_currency, date, rate) VALUES(?,?,?,?)", ("EUR", "USD", "2024-01-01", 0.9))
  conn.execute("INSERT INTO trades(trade_id, ticker, quantity, purchase, datetime, currency) VALUES(?,?,?,?,?,?)", ("T1", "ACME", 2, 120, "2024-01-01", "USD"))
  conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("ACME", "2024-01-02", 120, 0))
  conn.commit()
  trades, ticker_currency, _ = collect_trades_and_cash(conn)
  values = build_value_by_date(conn, trades, ticker_currency, "EUR")
  # 2 acciones * 120 USD * 0.9 = 216
  assert pytest.approx(values[date(2024, 1, 2)], rel=1e-6) == 216.0
