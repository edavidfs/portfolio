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


@pytest.fixture()
def temp_db(monkeypatch):
  with tempfile.TemporaryDirectory() as tmpdir:
    db_path = os.path.join(tmpdir, "test.db")
    monkeypatch.setenv("PORTFOLIO_DB_PATH", db_path)
    ensure_db_ready()
    yield db_path


def test_portfolio_value_series_only_transfers(temp_db):
  """
  Cobertura: REQ-BK-0006, REQ-BK-0009, REQ-UI-0018
  Verifica que la serie refleje el valor en moneda base incluso sin precios ni trades (solo caja de transferencias).
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    conn.execute("INSERT INTO app_config(key, value) VALUES('base_currency', 'EUR')")
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP1", "EUR", "2024-02-01", 100, "externo", "deposito"))
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP2", "EUR", "2024-02-02", -50, "externo", "retiro"))
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP3", "EUR", "2024-02-04", 50, "externo", "deposito"))
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/portfolio/value/series", params={"interval": "day"})
  assert resp.status_code == 200
  data = resp.json()
  series = data["series"]
  
  # Tres dias con movimientos, pero cuatro en total
  assert len(series) == 4
  assert series[0]["date"] == "2024-02-01"
  
  assert series[-1]["date"] == "2024-02-04"
  # Sin posiciones, el valor base debería reflejar la caja acumulada (100)
  assert pytest.approx(series[0]["value_base"], rel=1e-6) == 100
  assert pytest.approx(series[0]["transfers_base"], rel=1e-6) == 100
  # Día siguiente con retiro parcial
  assert series[1]["date"] == "2024-02-02"
  assert pytest.approx(series[1]["value_base"], rel=1e-6) == 50
  assert pytest.approx(series[1]["transfers_base"], rel=1e-6) == -50
  # El tercer dia sin operaciones
  assert series[2]["date"] == "2024-02-03"
  assert pytest.approx(series[2]["value_base"], rel=1e-6) == 50
  assert pytest.approx(series[2]["transfers_base"], rel=1e-6) == 0
  assert series[3]["date"] == "2024-02-04"
  assert pytest.approx(series[3]["value_base"], rel=1e-6) == 100
  assert pytest.approx(series[3]["transfers_base"], rel=1e-6) == 50


def test_portfolio_value_series_all_in_base_currency(temp_db):
  """
  Cobertura: REQ-BK-0006, REQ-BK-0009, REQ-BK-0008
  Escenario en moneda base EUR con depósito y compra de acciones en EUR.
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    conn.execute("INSERT INTO app_config(key, value) VALUES('base_currency', 'EUR')")
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP1", "EUR", "2024-03-01", 200, "externo", "deposito"))
    conn.execute("INSERT INTO trades(trade_id, ticker, quantity, purchase, datetime, currency) VALUES(?,?,?,?,?,?)", ("T1", "ACME", 5, 10, "2024-03-02", "EUR"))
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("ACME", "2024-03-02", 10, 0))
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("ACME", "2024-03-03", 11, 0))
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/portfolio/value/series", params={"interval": "day", "base": "EUR"})
  assert resp.status_code == 200
  series = resp.json()["series"]
  dates = [pt["date"] for pt in series]
  assert "2024-03-01" in dates
  assert "2024-03-02" in dates
  # Día 1: solo caja 200
  day1 = next(pt for pt in series if pt["date"] == "2024-03-01")
  assert series[0]["date"] == "2024-03-01"
  assert pytest.approx(series[0]["value_base"], rel=1e-6) == 200

  # Día 2: caja 150 + valor 5*10 = 200
  assert series[1]["date"] == "2024-03-02"
  assert pytest.approx(series[1]["value_base"], rel=1e-6) == 200

  # Día 2: caja 150 + valor 5*10 = 200
  assert series[2]["date"] == "2024-03-03"
  assert pytest.approx(series[2]["value_base"], rel=1e-6) == 205
  
def test_portfolio_value_series_fx_and_prices(temp_db):
    """
    Cobertura: REQ-BK-0006, REQ-BK-0009, REQ-UI-0018
    Verifica que la serie devuelve valores en la moneda base con FX diario y precios crecientes.
    """
    conn = get_connection(temp_db)
    ensure_schema(conn)
    try:
      # Base EUR
      conn.execute("INSERT INTO app_config(key, value) VALUES('base_currency', 'EUR')")
      # Transferencias externas en EUR: total 500
      conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP1", "EUR", "2024-01-01", 300, "externo", "deposito"))
      conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP2", "EUR", "2024-01-02", 200, "externo", "deposito"))
      # FX EUR/USD, precio base de 1 USD = 0.9 EUR y +0.2% diario
      fx_rates = [
        ("2024-01-03", 0.9),
        ("2024-01-04", 0.9 * 1.002),
        ("2024-01-05", 0.9 * (1.002 ** 2)),
        ("2024-01-06", 0.9 * (1.002 ** 3)),
        ("2024-01-07", 0.9 * (1.002 ** 4)),
      ]
      for d, rate in fx_rates:
        conn.execute("INSERT INTO fx_rates(base_currency, quote_currency, date, rate) VALUES(?, ?, ?, ?)", ("EUR", "USD", d, rate))
      # FX interno: convertir 400 EUR a USD el 3 de enero (no debe contar como aporte externo)
      conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("FXEUR", "EUR", "2024-01-03", -400, "fx_interno", "mov_interno"))
      conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("FXUSD", "USD", "2024-01-03", 400 / 0.9, "fx_interno", "mov_interno"))
      # Compra 2 acciones en USD el 3 de enero
      conn.execute("INSERT INTO trades(trade_id, ticker, quantity, purchase, datetime, currency) VALUES(?,?,?,?,?,?)", ("TST1", "ACME", 2, 120, "2024-01-03", "USD"))
      # Precios ACME en USD con +0.1% diario
      prices = [
        ("2024-01-03", 120.0),
        ("2024-01-04", 120.0 * 1.001),
        ("2024-01-05", 120.0 * (1.001 ** 2)),
        ("2024-01-06", 120.0 * (1.001 ** 3)),
        ("2024-01-07", 120.0 * (1.001 ** 4)),
      ]
      for d, close in prices:
        conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("ACME", d, close, 0))
      conn.commit()
    finally:
      conn.close()

    client = TestClient(app)
    resp = client.get("/portfolio/value/series")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["base_currency"] == "EUR"
    series = payload["series"]
    
    # Deben aparecer 7 fechas: 2 de transferencias + 5 de precios
    assert len(series) == 7
    # Transferencias acumuladas
    assert series[0]["date"] == "2024-01-01"
    assert pytest.approx(series[0]["transfers_base"], rel=1e-6) == 300
    assert pytest.approx(series[0]["value_base"], rel=1e-6) == 300
    assert series[0]["cash"]["EUR"] == 300
    assert series[0]["cash_base"]["EUR"] == 300

    assert series[1]["date"] == "2024-01-02"
    assert pytest.approx(series[1]["transfers_base"], rel=1e-6) == 200
    assert pytest.approx(series[1]["value_base"], rel=1e-6) == 500
    assert series[1]["cash"]["EUR"] == 500
    assert series[1]["cash_base"]["EUR"] == 500
    
    assert series[2]["date"] == "2024-01-03"
    assert pytest.approx(series[2]["transfers_base"], rel=1e-6) == 0
    assert pytest.approx(series[2]["value_base"], rel=1e-6) == 500
    assert series[2]["cash"]["EUR"] == 100
    assert pytest.approx(series[2]["cash_base"]["EUR"], rel=1e-6) == 100
    assert "USD" in series[2]["cash"]
    usd_cash_day3 = series[2]["cash"]["USD"]
    fx7 = 0.9 * (1.002 ** 4)
    price7 = 120 * (1.001 ** 4)
    # Último día crecimiento combinado de precio (+0.1% diario) y FX (+0.2% diario)
    last = series[-1]
    assert last["date"] == "2024-01-07"
    expected_last_value = 100 + usd_cash_day3 * fx7 + (2 * price7 * fx7)
    assert pytest.approx(last["value_base"], rel=1e-6) == pytest.approx(expected_last_value, rel=1e-6)


def test_portfolio_value_series_with_single_fx_rate(temp_db):
  """
  Cobertura: REQ-BK-0006, REQ-BK-0009, REQ-BK-0008
  Valida comportamiento cuando solo existe un FX en la tabla para todos los días.
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    conn.execute("INSERT INTO app_config(key, value) VALUES('base_currency', 'EUR')")
    # Solo un FX inicial y siguiente EUR/USD
    conn.execute("INSERT INTO fx_rates(base_currency, quote_currency, date, rate) VALUES(?, ?, ?, ?)", ("EUR", "USD", "2024-01-02", 0.9))
    conn.execute("INSERT INTO fx_rates(base_currency, quote_currency, date, rate) VALUES(?, ?, ?, ?)", ("EUR", "USD", "2024-01-04", 0.95))
    # Transferencia en EUR
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP1", "EUR", "2024-01-01", 500, "externo", "deposito"))
    # Compra USD y precios
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("FXEUR", "EUR", "2024-01-02", -400, "fx_interno", "mov_interno"))
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("FXUSD", "USD", "2024-01-02", 400 / 0.9, "fx_interno", "mov_interno"))
    
    conn.execute("INSERT INTO trades(trade_id, ticker, quantity, purchase, datetime, currency) VALUES(?,?,?,?,?,?)", ("TST1", "ACME", 1, 100, "2024-01-04", "USD"))
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("ACME", "2024-01-04", 100, 0))
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("ACME", "2024-01-05", 110, 0))
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("ACME", "2024-01-06", 105, 0))
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/portfolio/value/series", params={"interval": "day"})
  assert resp.status_code == 200
  series = resp.json()["series"]

  # print(series)
  assert series, "La serie no debería estar vacía"
  
  # Día 1: solo caja en EUR
  day1 = next(pt for pt in series if pt["date"] == "2024-01-01")
  assert pytest.approx(day1["value_base"], rel=1e-6) == 500

  # Día 2: Compra USD 400 USD * 0.9 = 444.44, pero al cambio es lo mismo
  day2 = next(pt for pt in series if pt["date"] == "2024-01-02")
  assert pytest.approx(day2["value_base"], rel=1e-6) == pytest.approx(500, rel=1e-6)
  
  # Día 3: sin precio aún, mantiene valor anterior
  day3 = next(pt for pt in series if pt["date"] == "2024-01-03")
  assert pytest.approx(day3["value_base"], rel=1e-6) == pytest.approx(500, rel=1e-6)


def test_portfolio_value_series_internal_fx_over_days(temp_db):
  """
  Cobertura: REQ-BK-0006, REQ-BK-0008, REQ-BK-0009
  Deposita EUR, convierte parte a USD al día siguiente (fx_interno) y valora el remanente con FX diarios en base USD.
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    conn.execute("INSERT INTO app_config(key, value) VALUES('base_currency', 'USD')")
    # FX USD/EUR para 4 días
    rates = [
      ("2024-01-01", 1.1),
      ("2024-01-02", 1.15),
      ("2024-01-03", 1.2),
      ("2024-01-04", 1.25),
    ]
    for d, rate in rates:
      conn.execute("INSERT INTO fx_rates(base_currency, quote_currency, date, rate) VALUES(?, ?, ?, ?)", ("USD", "EUR", d, rate))
    # Día 1: depósito externo 1000 EUR
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP1", "EUR", "2024-01-01", 1000, "externo", "deposito"))
    # Día 2: conversión interna de 400 EUR a USD
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("FXEUR", "EUR", "2024-01-02", -400, "fx_interno", "mov_interno"))
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("FXUSD", "USD", "2024-01-02", 400 * rates[1][1], "fx_interno", "mov_interno"))
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/portfolio/value/series", params={"interval": "day", "to": "2024-01-04"})
  assert resp.status_code == 200
  series = resp.json()["series"]

  print(series)

  assert len(series) == 4
  day1, day2, day3, day4 = series

  assert day1["date"] == "2024-01-01"
  assert pytest.approx(day1["transfers_base"], rel=1e-6) == 1000 * 1.1
  assert pytest.approx(day1["value_base"], rel=1e-6) == 1000 * 1.1
  assert day1["cash"]["EUR"] == 1000

  assert day2["date"] == "2024-01-02"
  assert pytest.approx(day2["transfers_base"], rel=1e-6) == 0
  # 600 EUR remanentes + 460 USD (400*1.15) en base USD
  assert pytest.approx(day2["value_base"], rel=1e-6) == pytest.approx(600 * 1.15 + 460, rel=1e-6)
  assert pytest.approx(day2["cash"]["EUR"], rel=1e-6) == 600
  assert pytest.approx(day2["cash"]["USD"], rel=1e-6) == pytest.approx(400 * 1.15, rel=1e-6)

  assert day3["date"] == "2024-01-03"
  assert pytest.approx(day3["value_base"], rel=1e-6) == pytest.approx(600 * 1.2 + 460, rel=1e-6)
  assert pytest.approx(day3["transfers_base"], rel=1e-6) == 0

  assert day4["date"] == "2024-01-04"
  assert pytest.approx(day4["value_base"], rel=1e-6) == pytest.approx(600 * 1.25 + 460, rel=1e-6)
  assert pytest.approx(day4["transfers_base"], rel=1e-6) == 0

[{'date': '2024-01-01', 'value_base': 1100.0, 'transfers_base': 1100.0, 'pnl_pct': 100.0, 'cash': {'EUR': 1000.0}, 'cash_base': {'EUR': 1100.0}}, 
 {'date': '2024-01-02', 'value_base': 1150.0, 'transfers_base': 0.0, 'pnl_pct': 104.54545454545455, 'cash': {'EUR': 600.0, 'USD': 459.99999999999994}, 'cash_base': {'EUR': 690.0, 'USD': 459.99999999999994}}]

def test_portfolio_value_multicurrency(temp_db):
  """
  Cobertura: REQ-BK-0002, REQ-BK-0005, REQ-UI-0016
  Valida cálculo de valor multimoneda (cash+posiciones) en la moneda base.
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    # FX: USD as base, EUR->USD rate 1.1
    conn.execute("INSERT INTO app_config(key, value) VALUES('base_currency', 'USD')")
    conn.execute("INSERT INTO fx_rates(base_currency, quote_currency, date, rate) VALUES(?, ?, ?, ?)", ("USD", "EUR", "2024-01-01", 1.1))
    # Cash: 1000 EUR, 500 USD
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP:EUR", "EUR", "2024-01-01", 1000, "externo", "deposito"))
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP:USD", "USD", "2024-01-02", 500, "externo", "deposito"))
    # Trade: 10 AAPL at $10
    conn.execute("INSERT INTO trades(trade_id, ticker, quantity, purchase, datetime, currency) VALUES(?,?,?,?,?,?)", ("T1", "AAPL", 10, 10, "2024-01-01", "USD"))
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("AAPL", "2024-01-10", 12, 0))
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/portfolio/value")
  assert resp.status_code == 200
  data = resp.json()
  assert data["base_currency"] == "USD"
  # Cash: 1000 EUR -> 1100 USD + 500 USD = 1600
  # Positions: 10 * $12 = 120
  assert pytest.approx(data["cash_base"], rel=1e-6) == 1600
  assert pytest.approx(data["positions_base"], rel=1e-6) == 120
  assert pytest.approx(data["total_base"], rel=1e-6) == 1720


def test_portfolio_value_series_monthly(temp_db):
  """
  Cobertura: REQ-BK-0006, REQ-BK-0009
  Verifica serie mensual agregada y conversiones a moneda base.
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    conn.execute("INSERT INTO app_config(key, value) VALUES('base_currency', 'USD')")
    # FX
    conn.execute("INSERT INTO fx_rates(base_currency, quote_currency, date, rate) VALUES(?, ?, ?, ?)", ("USD", "EUR", "2024-01-01", 1.2))
    # Trades
    conn.execute("INSERT INTO trades(trade_id, ticker, quantity, purchase, datetime, currency) VALUES(?,?,?,?,?,?)", ("T1", "AAPL", 10, 10, "2024-01-05", "USD"))
    conn.execute("INSERT INTO trades(trade_id, ticker, quantity, purchase, datetime, currency) VALUES(?,?,?,?,?,?)", ("T2", "BMW", 5, 90, "2024-01-10", "EUR"))
    # Prices
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("AAPL", "2024-01-31", 12, 0))
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("AAPL", "2024-02-29", 14, 0))
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("BMW", "2024-01-31", 90, 0))
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("BMW", "2024-02-29", 110, 0))
    # Transfers externas
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP1", "USD", "2024-01-01", 1000, "externo", "deposito"))
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP2", "EUR", "2024-02-10", 500, "externo", "deposito"))
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/portfolio/value/series", params={"interval": "month"})
  assert resp.status_code == 200
  payload = resp.json()
  assert payload["interval"] == "month"
  series = payload["series"]
  assert len(series) == 2
  jan, feb = series
  assert jan["date"] == "2024-01-31"
  assert pytest.approx(jan["transfers_base"], rel=1e-6) == 1000
  # Cash al 31/01: 900 USD y -450 EUR (=-540 USD) => 360; posiciones: 120 USD + 540 USD
  assert pytest.approx(jan["value_base"], rel=1e-6) == pytest.approx(1020, rel=1e-6)
  assert feb["date"] == "2024-02-29"
  assert pytest.approx(feb["transfers_base"], rel=1e-6) == (500 * 1.2)
  # Cash al 29/02: 900 USD y 50 EUR (=60 USD) => 960; posiciones: 10*14 + 5*110*1.2 = 800
  assert pytest.approx(feb["value_base"], rel=1e-6) == pytest.approx(1760, rel=1e-6)


def test_portfolio_value_series_rejects_invalid_interval(temp_db):
  """
  Cobertura: REQ-BK-0006
  Asegura validación de intervalos inválidos en la API de series.
  """
  client = TestClient(app)
  resp = client.get("/portfolio/value/series", params={"interval": "bad"})
  assert resp.status_code == 400


def test_portfolio_value_series_daily(temp_db):
  """
  Cobertura: REQ-BK-0006, REQ-BK-0009
  Asegura que el endpoint devuelve puntos cuando hay datos en la DB (transferencias y precios).
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    conn.execute("INSERT INTO app_config(key, value) VALUES('base_currency', 'EUR')")
    conn.execute("INSERT INTO fx_rates(base_currency, quote_currency, date, rate) VALUES(?, ?, ?, ?)", ("EUR", "USD", "2024-01-01", 0.9))
    conn.execute("INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)", ("DEP1", "EUR", "2024-01-01", 100, "externo", "deposito"))
    conn.execute("INSERT INTO trades(trade_id, ticker, quantity, purchase, datetime, currency) VALUES(?,?,?,?,?,?)", ("T1", "ACME", 1, 100, "2024-01-01", "USD"))
    conn.execute("INSERT INTO prices(ticker, date, close, provisional) VALUES(?,?,?,?)", ("ACME", "2024-01-02", 100, 0))
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/portfolio/value/series", params={"interval": "day", "base": "EUR"})
  assert resp.status_code == 200
  payload = resp.json()
  assert payload["series"], "Se esperaba serie con puntos y se devolvió vacía"


def test_portfolio_value_series_partial_with_missing_data(temp_db):
  """
  Cobertura: REQ-BK-0011
  Devuelve serie parcial con faltantes de FX y precios, marcando flags de sincronización.
  """
  conn = get_connection(temp_db)
  ensure_schema(conn)
  try:
    conn.execute("INSERT INTO app_config(key, value) VALUES('base_currency', 'USD')")
    # Falta FX USD/EUR para convertir el depósito
    conn.execute(
      "INSERT INTO transfers(transaction_id, currency, datetime, amount, origin, kind) VALUES(?,?,?,?,?,?)",
      ("DEP1", "EUR", "2024-01-01", 100, "externo", "deposito"),
    )
    # Trade sin precios disponibles
    conn.execute(
      "INSERT INTO trades(trade_id, ticker, quantity, purchase, datetime, currency) VALUES(?,?,?,?,?,?)",
      ("T1", "ACME", 1, 10, "2024-01-01", "USD"),
    )
    conn.commit()
  finally:
    conn.close()

  client = TestClient(app)
  resp = client.get("/portfolio/value/series", params={"interval": "day", "to": "2024-01-02"})
  assert resp.status_code == 200
  payload = resp.json()
  assert payload["sync_in_progress"] is True

  missing_fx = payload.get("missing_fx") or []
  assert {"date": "2024-01-01", "base_currency": "USD", "quote_currency": "EUR"} in missing_fx

  missing_prices = payload.get("missing_prices") or []
  assert {"date": "2024-01-01", "ticker": "ACME"} in missing_prices

  series = payload["series"]
  # Debe respetar el rango hasta 2024-01-02 aunque falten datos
  assert len(series) == 2
  assert series[0]["date"] == "2024-01-01"
  # Sin FX disponible, value_base en 0 pero la caja en EUR queda visible
  assert series[0]["cash"]["EUR"] == 100
  assert "EUR" not in series[0]["cash_base"]
  # El trade en USD sí impacta la caja en base
  assert pytest.approx(series[0]["cash_base"].get("USD", 0), rel=1e-6) == -10.0
  assert series[1]["date"] == "2024-01-02"
