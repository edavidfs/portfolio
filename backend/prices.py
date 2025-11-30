import logging
from pathlib import Path
import time as pytime
from datetime import date, datetime, time as dt_time, timedelta, timezone
from typing import Dict, List, Tuple

import yfinance as yf

RATE_LIMIT_SECONDS = 1.5
LOGGER = logging.getLogger(__name__)
if not LOGGER.handlers:
  log_path = Path(__file__).resolve().parent / "backend-fastapi.log"
  log_path.parent.mkdir(parents=True, exist_ok=True)
  handler = logging.FileHandler(log_path, encoding="utf-8")
  handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s"))
  LOGGER.addHandler(handler)
LOGGER.propagate = False

def _normalize_ticker(value: str) -> str:
  return str(value or '').strip().upper()


def _parse_trade_min_date(conn, ticker: str):
  cur = conn.execute("SELECT MIN(datetime) FROM trades WHERE ticker = ?", (ticker,))
  row = cur.fetchone()
  if not row or not row[0]:
    return None
  try:
    return datetime.fromisoformat(row[0]).date()
  except ValueError:
    try:
      return datetime.strptime(row[0], "%Y-%m-%d").date()
    except ValueError:
      return None


def _last_price_entry(conn, ticker: str):
  cur = conn.execute(
    "SELECT date, provisional FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 1",
    (ticker,)
  )
  row = cur.fetchone()
  if not row:
    return None, None
  return row[0], int(row[1] or 0)


def _fetch_yahoo_history(symbol: str, start_date: date, end_date: date) -> List[Tuple[date, float]]:
  if start_date > end_date:
    LOGGER.error("Rango de fechas inválido (%s-%s)", start_date, end_date)
    return []
  alias_candidates = [
    symbol.upper(),
    f"{symbol}.SW",
    f"{symbol}.SA",
    f"{symbol}.MX",
    f"{symbol}.BR",
    f"{symbol}.TW",
    f"{symbol}.TO",
    f"{symbol}.L"
  ]
  rows: List[Tuple[date, float]] = []
  max_attempts = 3
  for alias in alias_candidates:
    attempt = 0
    hist = None
    while attempt < max_attempts:
      try:
        hist = yf.download(alias, start=start_date, end=end_date + timedelta(days=1), interval="1d", auto_adjust=False, progress=False)
        break
      except Exception as exc:
        attempt += 1
        LOGGER.warning("Error al descargar precios de %s (intento %s/%s): %s", alias, attempt, max_attempts, exc)
        pytime.sleep(RATE_LIMIT_SECONDS * attempt)
    if hist is None:
      continue
    if hist.empty:
      LOGGER.info("Yahoo devolvió dataset vacío para %s", alias)
      continue
    rows.clear()
    for idx, row in hist.iterrows():
      close = row.get("Close")
      if close is None:
        continue
      d = idx.date() if hasattr(idx, "date") else date.fromisoformat(str(idx))
      rows.append((d, float(close)))
    if rows:
      LOGGER.info("Descargados %s registros para %s (alias %s)", len(rows), symbol, alias)
      return list(rows)
  LOGGER.warning("No se encontraron históricos para %s en Yahoo (alias probados: %s)", symbol, alias_candidates)
  return []


def _sync_single_ticker(conn, ticker: str) -> int:
  ticker = _normalize_ticker(ticker)
  if not ticker:
    return 0
  start = _parse_trade_min_date(conn, ticker)
  if not start:
    return 0
  last_date_str, provisional = _last_price_entry(conn, ticker)
  today = date.today()
  if last_date_str:
    try:
      last_date = date.fromisoformat(last_date_str)
    except ValueError:
      last_date = today
    if provisional:
      fetch_from = last_date
    else:
      fetch_from = last_date + timedelta(days=1)
  else:
    fetch_from = start
  if fetch_from > today:
    # nada nuevo que consultar
    return 0
  if fetch_from > start:
    fetch_from = max(start, fetch_from - timedelta(days=3))
  inserted = 0
  LOGGER.info("Sincronizando precios para %s desde %s hasta %s", ticker, fetch_from.isoformat(), today.isoformat())
  rows = _fetch_yahoo_history(ticker, fetch_from, today)
  if not rows:
    LOGGER.warning("No se encontraron precios recientes para %s; se omite actualización.", ticker)
    return 0
  for d, close in rows:
    provisional_flag = 1 if d >= today else 0
    conn.execute(
      """INSERT INTO prices (ticker, date, close, provisional)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(ticker, date) DO UPDATE SET close=excluded.close, provisional=excluded.provisional""",
      (ticker, d.isoformat(), close, provisional_flag)
    )
    inserted += 1
  LOGGER.info("Ticker %s sincronizado: %s registros (último=%s, provisional=%s)", ticker, inserted, rows[-1][0] if rows else "n/a", bool(rows and rows[-1][0] >= today))
  return inserted


def sync_prices_for_tickers(conn, tickers: List[str]) -> Dict[str, int]:
  summary: Dict[str, int] = {}
  normalized = [ _normalize_ticker(raw) for raw in (tickers or []) if _normalize_ticker(raw) ]
  for idx, ticker in enumerate(normalized):
    count = _sync_single_ticker(conn, ticker)
    summary[ticker] = count
    if idx < len(normalized) - 1:
      LOGGER.debug("Pausa %.2fs tras consultar %s", RATE_LIMIT_SECONDS, ticker)
      pytime.sleep(RATE_LIMIT_SECONDS)
  conn.commit()
  LOGGER.info("Resumen sincronización precios: %s", summary)
  return summary


def list_price_series(conn, ticker: str):
  ticker = _normalize_ticker(ticker)
  if not ticker:
    return []
  cur = conn.execute(
    "SELECT date, close, provisional FROM prices WHERE ticker = ? ORDER BY date ASC",
    (ticker,)
  )
  return [
    {"date": row[0], "close": row[1], "provisional": bool(row[2])}
    for row in cur.fetchall()
  ]


def latest_prices_for_tickers(conn, tickers: List[str]) -> Dict[str, Dict[str, object]]:
  out: Dict[str, Dict[str, object]] = {}
  for raw in tickers or []:
    ticker = _normalize_ticker(raw)
    if not ticker or ticker in out:
      continue
    cur = conn.execute(
      "SELECT date, close, provisional FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 1",
      (ticker,)
    )
    row = cur.fetchone()
    if not row:
      continue
    out[ticker] = {"date": row[0], "close": row[1], "provisional": bool(row[2])}
  return out
