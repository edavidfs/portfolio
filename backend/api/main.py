import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.params import Query
try:
  from platformdirs import user_data_dir
except ImportError:
  def user_data_dir(appname: str, *_args, **_kwargs) -> str:
    home = Path.home()
    if sys.platform == "darwin":
      return str(home / "Library" / "Application Support" / appname)
    if os.name == "nt":
      base = Path(os.environ.get("APPDATA", home))
      return str(base / appname)
    return str(home / ".local" / "share" / appname)
try:
  from dotenv import load_dotenv
except ImportError:
  def load_dotenv():
    return False
from pydantic import BaseModel

from db import ensure_schema, get_connection
from prices import list_price_series, latest_prices_for_tickers, sync_prices_for_tickers
from fx import sync_fx_for_currencies
from logging_config import configure_root_logging, LOG_PATH
from .portfolio_service import (
  _parse_date,
  _parse_db_datetime,
  _period_end_for,
  collect_trades_and_cash,
  collect_transfers_and_cash,
  build_buckets,
  build_series_from_buckets,
  build_value_by_date,
  convert_amount_on_date,
  schedule_missing_data_sync
)

BASE_DIR = Path(__file__).resolve().parent.parent
IMPORTER_PATH = BASE_DIR / 'importer.py'
APP_IDENTIFIER = "com.portfolio.desktop"

load_dotenv()
configure_root_logging()


def default_db_path() -> Path:
  """Ruta por defecto de la base de datos en el directorio de datos del usuario."""
  base = Path(user_data_dir(APP_IDENTIFIER, False))
  base.mkdir(parents=True, exist_ok=True)
  return base / 'portfolio.db'


def get_db_path() -> Path:
  """Resuelve la ruta de la base de datos (env PORTFOLIO_DB_PATH o default)."""
  env = os.environ.get('PORTFOLIO_DB_PATH')
  if env:
    return Path(env)
  return default_db_path()


def ensure_db_ready() -> Path:
  """Crea la carpeta y asegura el esquema de la base antes de operar."""
  db_path = get_db_path()
  db_path.parent.mkdir(parents=True, exist_ok=True)
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  conn.close()
  return db_path


def run_importer(kind: str, rows: List[Dict[str, Any]]):
  """
  Ejecuta el importador Python en un subproceso con un payload JSON temporal.
  Se usa para procesar CSV crudos (trades/transfers/dividends) y persistirlos en SQLite.
  """
  db_path = ensure_db_ready()
  log_path = db_path.with_suffix('.log')
  with tempfile.NamedTemporaryFile('w', delete=False, suffix='.json') as handle:
    json.dump(rows, handle, ensure_ascii=False, default=str)
    payload_path = Path(handle.name)
  cmd = [
    'python3',
    str(IMPORTER_PATH),
    '--db', str(db_path),
    '--kind', kind,
    '--log', str(log_path),
    '--payload', str(payload_path)
  ]
  try:
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return out.stdout.strip()
  except subprocess.CalledProcessError as exc:
    err = exc.stderr.strip() or exc.stdout.strip() or 'Fallo al ejecutar el importador'
    raise HTTPException(status_code=500, detail=f'Importador falló: {err}')
  finally:
    try:
      payload_path.unlink(missing_ok=True)
    except Exception:
      pass


def fetch_rows(query: str, columns: List[str]):
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    cur = conn.execute(query)
    results = []
    for row in cur.fetchall():
      results.append({col: row[idx] for idx, col in enumerate(columns)})
    return results
  finally:
    conn.close()


def get_config_value(key: str, default: Optional[str] = None) -> Optional[str]:
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    cur = conn.execute("SELECT value FROM app_config WHERE key = ?", (key,))
    row = cur.fetchone()
    return row[0] if row else default
  finally:
    conn.close()


def set_config_value(key: str, value: str) -> None:
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    conn.execute(
      "INSERT INTO app_config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      (key, value)
    )
    conn.commit()
  finally:
    conn.close()


def latest_fx_rate(conn, base: str, quote: str) -> Optional[float]:
  if not base or not quote:
    return None
  if base.upper() == quote.upper():
    return 1.0
  cur = conn.execute(
    "SELECT rate FROM fx_rates WHERE base_currency = ? AND quote_currency = ? ORDER BY date DESC LIMIT 1",
    (base.upper(), quote.upper())
  )
  row = cur.fetchone()
  return float(row[0]) if row else None


def convert_amount(conn, amount: float, from_currency: str, base_currency: str) -> float:
  rate = latest_fx_rate(conn, base_currency, from_currency)
  if rate is None:
    raise HTTPException(status_code=400, detail=f'No hay tipo de cambio para {from_currency}->{base_currency}')
  return amount * rate


class RowsPayload(BaseModel):
  rows: List[Dict[str, Any]]

class TickersPayload(BaseModel):
  tickers: List[str]

class BaseCurrencyPayload(BaseModel):
  currency: str

class FxRatePayload(BaseModel):
  base_currency: str
  quote_currency: str
  rate: float
  date: Optional[str] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
  ensure_db_ready()
  logging.info("Base de datos en %s", get_db_path())
  yield


logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
app = FastAPI(title='Portfolio Backend', version='0.1.0', lifespan=lifespan)
app.add_middleware(
  CORSMiddleware,
  allow_origins=['*'],
  allow_credentials=True,
  allow_methods=['*'],
  allow_headers=['*']
)


@app.get('/health')
def health_check():
  return {'status': 'ok'}


@app.get('/config')
def get_config():
  base = get_config_value('base_currency', default='USD')
  return {'base_currency': base}


@app.post('/config/base-currency')
def update_base_currency(payload: BaseCurrencyPayload):
  currency = (payload.currency or '').strip().upper()
  if not currency or len(currency) < 3 or len(currency) > 6:
    raise HTTPException(status_code=400, detail='Moneda base inválida.')
  set_config_value('base_currency', currency)
  return {'status': 'ok', 'base_currency': currency}


@app.post('/fx/rate')
def set_fx_rate(payload: FxRatePayload):
  base = (payload.base_currency or '').strip().upper()
  quote = (payload.quote_currency or '').strip().upper()
  if not base or not quote or base == quote:
    raise HTTPException(status_code=400, detail='Par de divisas inválido.')
  if payload.rate <= 0:
    raise HTTPException(status_code=400, detail='La tasa debe ser positiva.')
  date = (payload.date or datetime.utcnow().date().isoformat())
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    conn.execute(
      """INSERT INTO fx_rates(base_currency, quote_currency, date, rate)
         VALUES(?, ?, ?, ?)
         ON CONFLICT(base_currency, quote_currency, date) DO UPDATE SET rate=excluded.rate""",
      (base, quote, date, payload.rate)
    )
    conn.commit()
  finally:
    conn.close()
  return {'status': 'ok', 'base_currency': base, 'quote_currency': quote, 'date': date, 'rate': payload.rate}


def _list_currencies_in_use(conn) -> List[str]:
  cur = conn.execute("SELECT DISTINCT currency FROM trades WHERE currency IS NOT NULL")
  trade_curs = [row[0] for row in cur.fetchall()]
  cur = conn.execute("SELECT DISTINCT currency FROM transfers WHERE currency IS NOT NULL")
  transfer_curs = [row[0] for row in cur.fetchall()]
  cur = conn.execute("SELECT DISTINCT currency FROM dividends WHERE currency IS NOT NULL")
  dividend_curs = [row[0] for row in cur.fetchall()]
  return list({*(c.upper() for c in trade_curs if c), *(c.upper() for c in transfer_curs if c), *(c.upper() for c in dividend_curs if c)})


@app.post('/fx/sync')
def sync_fx(payload: TickersPayload):
  """
  Sincroniza tipos de cambio para las divisas indicadas contra la moneda base configurada.
  """
  logging.info("Vamos a actualizar los FX")
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    base_currency = (get_config_value('base_currency', 'USD') or 'USD').upper()
    currencies = payload.tickers or _list_currencies_in_use(conn)
    if not currencies:
      raise HTTPException(status_code=400, detail='No hay divisas para sincronizar.')
    summary = sync_fx_for_currencies(conn, base_currency, currencies)
    return {'status': 'ok', 'base_currency': base_currency, 'updated': summary}
  finally:
    conn.close()


@app.post('/import/transfers')
def import_transfers(payload: RowsPayload):
  if not payload.rows:
    raise HTTPException(status_code=400, detail='No se enviaron filas a importar.')
  run_importer('transfers', payload.rows)
  return {'status': 'ok', 'rows': len(payload.rows)}


@app.post('/import/trades')
def import_trades(payload: RowsPayload):
  if not payload.rows:
    raise HTTPException(status_code=400, detail='No se enviaron filas a importar.')
  run_importer('trades', payload.rows)
  # Sincronizar FX para las divisas detectadas en los trades importados
  currencies = set()
  for row in payload.rows:
    cur = (row.get('CurrencyPrimary') or row.get('currency') or '').upper()
    if cur:
      currencies.add(cur)
  if currencies:
    base_currency = (get_config_value('base_currency', 'USD') or 'USD').upper()
    conn = get_connection(str(get_db_path()))
    try:
      sync_fx_for_currencies(conn, base_currency, currencies)
    finally:
      conn.close()
  return {'status': 'ok', 'rows': len(payload.rows)}


@app.post('/import/dividends')
def import_dividends(payload: RowsPayload):
  if not payload.rows:
    raise HTTPException(status_code=400, detail='No se enviaron filas a importar.')
  run_importer('dividends', payload.rows)
  return {'status': 'ok', 'rows': len(payload.rows)}


@app.get('/transfers')
def list_transfers():
  rows = fetch_rows(
    "SELECT transaction_id, currency, datetime, amount, origin, kind FROM transfers ORDER BY datetime ASC",
    ['transaction_id', 'currency', 'datetime', 'amount', 'origin', 'kind']
  )
  return rows


@app.get('/cash/balance')
def cash_balance():
  """
  Devuelve balance por divisa sin conversión FX, sumando transferencias, dividendos y flujo de trades (STK/OPT).
  Incluye transferencias externas e internas; no descuenta valor de posiciones.
  """
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    # Transferencias
    cur = conn.execute("""
      SELECT currency, SUM(amount) as total
      FROM transfers
      GROUP BY currency
    """)
    transfer_totals = { (row[0] or '').upper(): float(row[1] or 0.0) for row in cur.fetchall() }

    # Dividendos
    cur = conn.execute("""
      SELECT currency, SUM(amount) as total
      FROM dividends
      GROUP BY currency
    """)
    for currency, total in cur.fetchall():
      key = (currency or '').upper()
      transfer_totals[key] = transfer_totals.get(key, 0.0) + float(total or 0.0)

    # Trades STK: flujo de caja por compra/venta y comisión si misma divisa
    cur = conn.execute("""
      SELECT currency, quantity, purchase, commission, commission_currency
      FROM trades
      WHERE asset_class = 'STK'
    """)
    for currency, qty, price, commission, comm_cur in cur.fetchall():
      ccy = (currency or '').upper()
      if not ccy:
        continue
      q = float(qty or 0.0)
      p = float(price or 0.0)
      comm = float(commission or 0.0)
      comm_ccy = (comm_cur or '').upper()
      flow = -(q * p)  # compra: qty>0 => flujo negativo; venta qty<0 => flujo positivo
      if not comm_ccy or comm_ccy == ccy:
        flow -= comm
      transfer_totals[ccy] = transfer_totals.get(ccy, 0.0) + flow

    balances = [{'currency': cur, 'balance': round(val, 4)} for cur, val in transfer_totals.items()]
    return {'balances': balances}
  finally:
    conn.close()


@app.get('/transfers/series')
def transfers_series(interval: str = Query('day', pattern='^(day|month)$'), from_date: Optional[str] = None, to_date: Optional[str] = None):
  """
  Serie de transferencias por divisa sin convertir FX.
  Incluye transferencias externas e internas; cada divisa mantiene su propio acumulado.
  """
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    rows = fetch_rows(
      "SELECT currency, datetime, amount, origin FROM transfers ORDER BY datetime ASC",
      ['currency', 'datetime', 'amount', 'origin']
    )
  finally:
    conn.close()

  def parse_dt(dt_str: str) -> date:
    return datetime.fromisoformat(dt_str).date()

  def bucket_for(d: date) -> date:
    if interval == 'month':
      return date(d.year, d.month, 1)
    return d

  from_d = datetime.fromisoformat(from_date).date() if from_date else None
  to_d = datetime.fromisoformat(to_date).date() if to_date else None

  series: Dict[str, Dict[date, float]] = {}
  for row in rows:
    try:
      dt = parse_dt(str(row['datetime']))
    except Exception:
      continue
    if from_d and dt < from_d:
      continue
    if to_d and dt > to_d:
      continue
    cur = (row.get('currency') or '').upper() or 'N/A'
    amount = float(row.get('amount') or 0.0)
    bucket = bucket_for(dt)
    by_date = series.setdefault(cur, {})
    by_date[bucket] = by_date.get(bucket, 0.0) + amount

  result: Dict[str, List[Dict[str, Any]]] = {}
  for cur, by_date in series.items():
    cumulative = 0.0
    points = []
    for day in sorted(by_date.keys()):
      cumulative += by_date[day]
      points.append({
        'date': day.isoformat(),
        'amount': round(by_date[day], 4),
        'cumulative': round(cumulative, 4)
      })
    result[cur] = points

  return {
    'interval': interval,
    'series': result
  }


@app.get('/cash/series')
def cash_series(interval: str = Query('day', pattern='^(day|month)$'), from_date: Optional[str] = None, to_date: Optional[str] = None):
  """
  Serie temporal de efectivo por divisa (transferencias + dividendos + trades STK), sin conversión FX.
  """
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    transfers = fetch_rows(
      "SELECT currency, datetime, amount FROM transfers ORDER BY datetime ASC",
      ['currency', 'datetime', 'amount']
    )
    dividends = fetch_rows(
      "SELECT currency, datetime, amount FROM dividends ORDER BY datetime ASC",
      ['currency', 'datetime', 'amount']
    )
    trades = fetch_rows(
      "SELECT currency, datetime, quantity, purchase, commission, commission_currency FROM trades WHERE asset_class = 'STK' ORDER BY datetime ASC",
      ['currency', 'datetime', 'quantity', 'purchase', 'commission', 'commission_currency']
    )
  finally:
    conn.close()

  def parse_dt(dt_str: str) -> date:
    return datetime.fromisoformat(dt_str).date()

  def bucket_for(d: date) -> date:
    if interval == 'month':
      return date(d.year, d.month, 1)
    return d

  from_d = datetime.fromisoformat(from_date).date() if from_date else None
  to_d = datetime.fromisoformat(to_date).date() if to_date else None

  series: Dict[str, Dict[date, float]] = {}
  rows_all: List[Dict[str, Any]] = []
  rows_all.extend(transfers)
  rows_all.extend(dividends)
  # Trades STK -> flujo de caja
  for row in trades:
    currency = (row.get('currency') or '').upper()
    if not currency:
      continue
    qty = float(row.get('quantity') or 0.0)
    price = float(row.get('purchase') or 0.0)
    commission = float(row.get('commission') or 0.0)
    comm_cur = (row.get('commission_currency') or '').upper()
    flow = -(qty * price)
    if not comm_cur or comm_cur == currency:
      flow -= commission
    rows_all.append({'currency': currency, 'datetime': row.get('datetime'), 'amount': flow})

  for row in rows_all:
    try:
      dt = parse_dt(str(row['datetime']))
    except Exception:
      continue
    if from_d and dt < from_d:
      continue
    if to_d and dt > to_d:
      continue
    cur = (row.get('currency') or '').upper() or 'N/A'
    amount = float(row.get('amount') or 0.0)
    bucket = bucket_for(dt)
    by_date = series.setdefault(cur, {})
    by_date[bucket] = by_date.get(bucket, 0.0) + amount

  result: Dict[str, List[Dict[str, Any]]] = {}
  for cur, by_date in series.items():
    cumulative = 0.0
    points = []
    for day in sorted(by_date.keys()):
      cumulative += by_date[day]
      points.append({
        'date': day.isoformat(),
        'amount': round(by_date[day], 4),
        'cumulative': round(cumulative, 4)
      })
    result[cur] = points

  return {
    'interval': interval,
    'series': result
  }


@app.get('/portfolio/value')
def portfolio_value():
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    base_currency = (get_config_value('base_currency', 'USD') or 'USD').upper()
    # Cash por divisa
    cur = conn.execute("SELECT currency, SUM(amount) FROM transfers GROUP BY currency")
    cash_base = 0.0
    cash_breakdown = []
    for currency, total in cur.fetchall():
      total = float(total or 0)
      converted = convert_amount(conn, total, currency, base_currency)
      cash_base += converted
      cash_breakdown.append({'currency': currency, 'amount': total, 'amount_base': converted})
    # Posiciones
    positions = {}
    cur = conn.execute("SELECT ticker, quantity, currency FROM trades")
    for ticker, qty, currency in cur.fetchall():
      if not ticker:
        continue
      if ticker not in positions:
        positions[ticker] = {'qty': 0.0, 'currency': (currency or '').upper()}
      positions[ticker]['qty'] += float(qty or 0)
      if not positions[ticker]['currency'] and currency:
        positions[ticker]['currency'] = (currency or '').upper()
    tickers = [t for t, info in positions.items() if abs(info['qty']) > 1e-9]
    latest = latest_prices_for_tickers(conn, tickers)
    positions_base = 0.0
    positions_breakdown = []
    for ticker in tickers:
      info = positions[ticker]
      price_info = latest.get(ticker)
      if not price_info:
        continue
      price = float(price_info.get('close') or 0)
      value = info['qty'] * price
      currency = info['currency'] or base_currency
      converted = convert_amount(conn, value, currency, base_currency)
      positions_base += converted
      positions_breakdown.append({'ticker': ticker, 'qty': info['qty'], 'price': price, 'currency': currency, 'value': value, 'value_base': converted})
    total_base = cash_base + positions_base
    return {
      'base_currency': base_currency,
      'cash_base': cash_base,
      'positions_base': positions_base,
      'total_base': total_base,
      'cash': cash_breakdown,
      'positions': positions_breakdown
    }
  finally:
    conn.close()


@app.get('/portfolio/value/series')
def portfolio_value_series(
  interval: str = Query(default='day', description="day|week|month|quarter|year"),
  from_date: Optional[str] = Query(default=None, alias="from", description="Fecha mínima ISO (YYYY-MM-DD)"),
  to_date: Optional[str] = Query(default=None, alias="to", description="Fecha máxima ISO (YYYY-MM-DD)"),
  base: Optional[str] = Query(default=None, description="Moneda base deseada (default: config)")
):
  interval = (interval or 'day').strip().lower()
  if interval not in {'day', 'week', 'month', 'quarter', 'year'}:
    raise HTTPException(status_code=400, detail='Intervalo inválido, use day|week|month|quarter|year')
  from_d = _parse_date(from_date)
  to_d = _parse_date(to_date)
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    base_currency = (base or get_config_value('base_currency', 'USD') or 'USD').upper()
    missing_data: Dict[str, set] = {'fx': set(), 'prices': set()}
    trades, ticker_currency, cash_movements = collect_trades_and_cash(conn)
    value_by_date = build_value_by_date(conn, trades, ticker_currency, base_currency, missing_data=missing_data)
    transfer_by_date, cash_movements = collect_transfers_and_cash(conn, base_currency, cash_movements, missing_data=missing_data)
    buckets = build_buckets(from_d, to_d, interval, value_by_date, transfer_by_date, cash_movements)
    out = build_series_from_buckets(conn, buckets, base_currency, missing_data=missing_data)
    sync_in_progress = bool(missing_data.get('fx') or missing_data.get('prices'))
    if sync_in_progress:
      schedule_missing_data_sync(missing_data)
    data = {
      'base_currency': base_currency,
      'interval': interval,
      'from': from_date,
      'to': to_date,
      'series': out,
      'sync_in_progress': sync_in_progress,
      'missing_fx': [
        {'date': d, 'base_currency': base, 'quote_currency': quote}
        for (d, base, quote) in sorted(missing_data.get('fx', set()))
      ],
      'missing_prices': [
        {'date': d, 'ticker': ticker}
        for (d, ticker) in sorted(missing_data.get('prices', set()))
      ]
    }
    
    logging.info(data)

    return data
  finally:
    conn.close()


@app.post('/reset')
def reset_database():
  logging.info("Borrando Base de datos")
  db_path = get_db_path()
  if db_path.exists():
    db_path.unlink()
  log_path = db_path.with_suffix('.log')
  if log_path.exists():
    log_path.unlink()
  return {'status': 'ok', 'deleted': True}


@app.get('/trades')
def list_trades():
  rows = fetch_rows(
    "SELECT trade_id, ticker, quantity, purchase, datetime, commission, commission_currency, currency, isin, asset_class, raw_json FROM trades ORDER BY datetime ASC",
    ['trade_id', 'ticker', 'quantity', 'purchase', 'datetime', 'commission', 'commission_currency', 'currency', 'isin', 'asset_class', 'raw_json']
  )
  return rows


@app.get('/cash/net-transfers')
def net_transfers(
  from_date: Optional[str] = Query(default=None, description="Fecha mínima ISO (YYYY-MM-DD)"),
  to_date: Optional[str] = Query(default=None, description="Fecha máxima ISO (YYYY-MM-DD)"),
  base: Optional[str] = Query(default=None, description="Moneda base deseada (default: config)")
):
  db_path = ensure_db_ready()
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  try:
    params: List[Any] = []
    clauses: List[str] = []
    clauses.append("origin = 'externo'")
    if from_date:
      clauses.append("datetime >= ?")
      params.append(from_date)
    if to_date:
      clauses.append("datetime <= ?")
      params.append(to_date)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    query = f"SELECT currency, SUM(amount) as total FROM transfers {where} GROUP BY currency"
    cur = conn.execute(query, params)
    totals = []
    for row in cur.fetchall():
      totals.append({'currency': row[0], 'total': row[1]})
    base_currency = (base or get_config_value('base_currency', 'USD') or 'USD').upper()
    return {'base_currency': base_currency, 'totals': totals}
  finally:
    conn.close()


@app.post('/prices/sync')
def sync_prices(payload: TickersPayload):
  logging.info("VAmos a actualizar los precios")
  if not payload.tickers:
    raise HTTPException(status_code=400, detail='No se enviaron tickers para actualizar.')
  ensure_db_ready()
  conn = get_connection(str(get_db_path()))
  try:
    summary = sync_prices_for_tickers(conn, payload.tickers)
  finally:
    conn.close()
  return {'status': 'ok', 'updated': summary}


@app.post('/prices/latest')
def latest_prices(payload: TickersPayload):
  logging.info("VAmos a actualizar los precios latest")
  if not payload.tickers:
    return {}
  ensure_db_ready()
  conn = get_connection(str(get_db_path()))
  try:
    return latest_prices_for_tickers(conn, payload.tickers)
  finally:
    conn.close()


@app.get('/prices/{ticker}')
def prices_series(ticker: str):
  ensure_db_ready()
  conn = get_connection(str(get_db_path()))
  try:
    return list_price_series(conn, ticker)
  finally:
    conn.close()


@app.get('/dividends')
def list_dividends():
  rows = fetch_rows(
    "SELECT action_id, ticker, currency, datetime, amount, gross, tax, issuer_country FROM dividends ORDER BY datetime ASC",
    ['action_id', 'ticker', 'currency', 'datetime', 'amount', 'gross', 'tax', 'issuer_country']
  )
  return rows
