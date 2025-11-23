import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

BASE_DIR = Path(__file__).resolve().parent.parent
IMPORTER_PATH = BASE_DIR / 'importer.py'
APP_IDENTIFIER = "com.portfolio.desktop"

load_dotenv()


def default_db_path() -> Path:
  base = Path(user_data_dir(APP_IDENTIFIER, False))
  base.mkdir(parents=True, exist_ok=True)
  return base / 'portfolio.db'


def get_db_path() -> Path:
  env = os.environ.get('PORTFOLIO_DB_PATH')
  if env:
    return Path(env)
  return default_db_path()


def ensure_db_ready() -> Path:
  db_path = get_db_path()
  db_path.parent.mkdir(parents=True, exist_ok=True)
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  conn.close()
  return db_path


def run_importer(kind: str, rows: List[Dict[str, Any]]):
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


class RowsPayload(BaseModel):
  rows: List[Dict[str, Any]]

class TickersPayload(BaseModel):
  tickers: List[str]


logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
app = FastAPI(title='Portfolio Backend', version='0.1.0')
app.add_middleware(
  CORSMiddleware,
  allow_origins=['*'],
  allow_credentials=True,
  allow_methods=['*'],
  allow_headers=['*']
)


@app.on_event('startup')
async def startup_event():
  ensure_db_ready()
  logging.info("Base de datos en %s", get_db_path())


@app.get('/health')
def health_check():
  return {'status': 'ok'}


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
    "SELECT transaction_id, currency, datetime, amount FROM transfers ORDER BY datetime ASC",
    ['transaction_id', 'currency', 'datetime', 'amount']
  )
  return rows


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
    "SELECT trade_id, ticker, quantity, purchase, datetime, commission, commission_currency, currency, isin, asset_class FROM trades ORDER BY datetime ASC",
    ['trade_id', 'ticker', 'quantity', 'purchase', 'datetime', 'commission', 'commission_currency', 'currency', 'isin', 'asset_class']
  )
  return rows


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
