import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Añadir raíz del backend al sys.path para resolver imports en modo pytest local
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
  sys.path.insert(0, str(BACKEND_ROOT))

from api.main import app, ensure_db_ready, get_connection, ensure_schema  # noqa: E402


def insert_transfer(conn, tx_id: str, currency: str, dt: str, amount: float, origin: str = "externo", kind: str = "deposito"):
  conn.execute(
    "INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?, ?, ?, ?, ?, ?)",
    (tx_id, currency, dt, amount, origin, kind)
  )


def insert_dividend(conn, action_id: str, currency: str, dt: str, amount: float, tax: float = 0.0):
  conn.execute(
    "INSERT INTO dividends(action_id, currency, datetime, amount, tax) VALUES(?, ?, ?, ?, ?)",
    (action_id, currency, dt, amount, tax)
  )


@pytest.fixture()
def temp_db(monkeypatch):
  with tempfile.TemporaryDirectory() as tmpdir:
    db_path = os.path.join(tmpdir, "test.db")
    monkeypatch.setenv("PORTFOLIO_DB_PATH", db_path)
    ensure_db_ready()
    yield db_path


def test_cash_balance_sums_transfers_and_dividends(temp_db):
  """
  Cobertura: REQ-BK-0012
  Verifica que /cash/balance suma transferencias y dividendos por divisa sin FX.
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    insert_transfer(conn, "DEP:1", "EUR", "2024-01-02", 1000, "externo", "deposito")
    insert_transfer(conn, "FX:1", "EUR", "2024-01-03", -300, "fx_interno", "mov_interno")
    insert_transfer(conn, "FX:1:USD", "USD", "2024-01-03", 320, "fx_interno", "mov_interno")
    insert_dividend(conn, "DIV:1", "EUR", "2024-02-01", 50, 0)
    insert_transfer(conn, "OPT:1", "USD", "2024-02-10", 80, "externo", "deposito")  # prima de opciones
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/cash/balance")
  assert resp.status_code == 200
  data = resp.json()
  balances = {row["currency"]: row["balance"] for row in data.get("balances", [])}
  assert balances.get("EUR") == pytest.approx(750)  # 1000 - 300 + 50
  assert balances.get("USD") == pytest.approx(320 + 80)


def test_cash_series_day(temp_db):
  """
  Cobertura: REQ-BK-0012
  Verifica serie diaria de efectivo por divisa.
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    insert_transfer(conn, "DEP:1", "EUR", "2024-01-02", 1000, "externo", "deposito")
    insert_transfer(conn, "RET:1", "EUR", "2024-01-05", -200, "externo", "retiro")
    insert_dividend(conn, "DIV:1", "EUR", "2024-01-06", 100, 0)
    insert_transfer(conn, "FX:1:USD", "USD", "2024-01-10", 320, "fx_interno", "mov_interno")
    insert_transfer(conn, "OPT:1", "USD", "2024-01-12", 50, "externo", "deposito")  # prima opciones
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/cash/series?interval=day")
  assert resp.status_code == 200
  data = resp.json()
  assert data.get("interval") == "day"
  series = data.get("series", {})
  eur = series.get("EUR", [])
  usd = series.get("USD", [])
  assert eur[-1]["cumulative"] == pytest.approx(900)  # 1000 - 200 + 100
  assert usd[-1]["cumulative"] == pytest.approx(370)  # 320 + 50


def test_cash_series_month_invalid_interval(temp_db):
  """
  Cobertura: REQ-BK-0012
  Responde 422 con interval inválido.
  """
  client = TestClient(app)
  resp = client.get("/cash/series?interval=year")
  assert resp.status_code == 422
