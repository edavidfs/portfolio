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


@pytest.fixture()
def temp_db(monkeypatch):
  with tempfile.TemporaryDirectory() as tmpdir:
    db_path = os.path.join(tmpdir, "test.db")
    monkeypatch.setenv("PORTFOLIO_DB_PATH", db_path)
    ensure_db_ready()
    yield db_path


def test_transfers_series_accumulates_by_currency(temp_db):
  """
  Cobertura: REQ-BK-0012
  Valida que /transfers/series devuelve montos y acumulados por divisa (day) sin conversión FX.
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    # Externas EUR
    insert_transfer(conn, "DEP:1", "EUR", "2024-01-02", 1000, "externo", "deposito")
    insert_transfer(conn, "RET:1", "EUR", "2024-01-05", -200, "externo", "retiro")
    # Internas FX: EUR->USD
    insert_transfer(conn, "FX:1", "EUR", "2024-01-10", -300, "fx_interno", "mov_interno")
    insert_transfer(conn, "FX:1:USD", "USD", "2024-01-10", 320, "fx_interno", "mov_interno")
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/transfers/series?interval=day")
  assert resp.status_code == 200
  data = resp.json()
  assert data.get("interval") == "day"
  series = data.get("series", {})
  assert "EUR" in series and "USD" in series

  eur_points = series["EUR"]
  usd_points = series["USD"]

  # EUR: 1000 - 200 - 300 = 500 acumulado final
  assert len(eur_points) == 3
  assert eur_points[0]["amount"] == pytest.approx(1000)
  assert eur_points[0]["cumulative"] == pytest.approx(1000)
  assert eur_points[1]["amount"] == pytest.approx(-200)
  assert eur_points[1]["cumulative"] == pytest.approx(800)
  assert eur_points[2]["amount"] == pytest.approx(-300)
  assert eur_points[2]["cumulative"] == pytest.approx(500)

  # USD: solo entrada de FX interno
  assert len(usd_points) == 1
  assert usd_points[0]["amount"] == pytest.approx(320)
  assert usd_points[0]["cumulative"] == pytest.approx(320)


def test_transfers_series_rejects_invalid_interval(temp_db):
  """
  Cobertura: REQ-BK-0012
  Valida que interval inválido devuelve error 422.
  """
  client = TestClient(app)
  resp = client.get("/transfers/series?interval=year")
  assert resp.status_code == 422


def test_transfers_series_monthly_bucket(temp_db):
  """
  Cobertura: REQ-BK-0012
  Valida agregado mensual sin convertir FX.
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    insert_transfer(conn, "DEP:1", "EUR", "2024-01-02", 1000, "externo", "deposito")
    insert_transfer(conn, "DEP:2", "EUR", "2024-01-15", 500, "externo", "deposito")
    insert_transfer(conn, "RET:1", "EUR", "2024-02-01", -200, "externo", "retiro")
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/transfers/series?interval=month")
  assert resp.status_code == 200
  data = resp.json()
  assert data.get("interval") == "month"
  series = data.get("series", {})
  eur_points = series.get("EUR", [])
  # Debe agrupar por primer día del mes
  assert eur_points[0]["date"].startswith("2024-01-01")
  assert eur_points[0]["amount"] == pytest.approx(1500)
  assert eur_points[0]["cumulative"] == pytest.approx(1500)
  assert eur_points[1]["date"].startswith("2024-02-01")
  assert eur_points[1]["amount"] == pytest.approx(-200)
  assert eur_points[1]["cumulative"] == pytest.approx(1300)
