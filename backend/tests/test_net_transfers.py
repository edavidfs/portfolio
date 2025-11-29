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


@pytest.fixture()
def temp_db(monkeypatch):
  with tempfile.TemporaryDirectory() as tmpdir:
    db_path = os.path.join(tmpdir, "test.db")
    monkeypatch.setenv("PORTFOLIO_DB_PATH", db_path)
    # inicializa esquema
    ensure_db_ready()
    yield db_path


def insert_transfer(conn, transaction_id: str, currency: str, dt: str, amount: float, origin: str = "externo", kind: str = "deposito"):
  conn.execute(
    "INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?, ?, ?, ?, ?, ?)",
    (transaction_id, currency, dt, amount, origin, kind)
  )


def test_net_transfers_excludes_fx_and_groups_by_currency(temp_db):
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    insert_transfer(conn, "DEP:1", "EUR", "2024-01-10", 10000, "externo", "deposito")
    insert_transfer(conn, "WITH:1", "EUR", "2024-02-01", -2000, "externo", "retiro")
    insert_transfer(conn, "FX:EUR.USD:1", "EUR", "2024-02-10", -5000, "fx_interno", "mov_interno")  # debe ignorarse
    insert_transfer(conn, "STK:EUR.USD:1", "EUR", "2024-02-10", -5000, "operacion", "operacion")  # debe ignorarse
    insert_transfer(conn, "OPT:EUR.USD:1", "EUR", "2024-02-10", -5000, "operacion", "operacion")  # debe ignorarse
    insert_transfer(conn, "DEP:2", "USD", "2024-03-05", 1000, "externo", "deposito")
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/cash/net-transfers")
  assert resp.status_code == 200
  data = resp.json()
  totals = {row["currency"]: row["total"] for row in data.get("totals", [])}
  assert pytest.approx(totals.get("EUR", 0), rel=1e-9) == 8000  # 10000 - 2000
  assert pytest.approx(totals.get("USD", 0), rel=1e-9) == 1000
  # FX interno no debe afectar los totales
  assert "EUR" in totals and totals["EUR"] == pytest.approx(8000)
