import logging
from datetime import date, timedelta
from typing import Dict, Iterable, List, Tuple

import yfinance as yf

LOGGER = logging.getLogger(__name__)


def _fetch_yahoo_fx_history(symbol: str, start: date, end: date) -> List[Tuple[date, float]]:
  """Descarga histórico diario de FX desde Yahoo Finance para un símbolo tipo EURUSD=X."""
  hist = yf.download(symbol, start=start, end=end + timedelta(days=1), interval="1d", auto_adjust=False, progress=False)
  if hist is None or hist.empty:
    LOGGER.info("Yahoo devolvió dataset vacío para %s", symbol)
    return []
  rows: List[Tuple[date, float]] = []
  for idx, row in hist.iterrows():
    close = row.get("Close")
    if close is None:
      continue
    d = idx.date() if hasattr(idx, "date") else date.fromisoformat(str(idx))
    rows.append((d, float(close)))
  return rows


def _min_date_for_currency(conn, currency: str) -> date:
  cur = conn.execute("SELECT MIN(datetime) FROM transfers WHERE currency = ?", (currency,))
  tmin = cur.fetchone()[0]
  cur2 = conn.execute("SELECT MIN(datetime) FROM trades WHERE currency = ?", (currency,))
  tmin2 = cur2.fetchone()[0]
  dates = [v for v in [tmin, tmin2] if v]
  if not dates:
    return date.today()
  parsed = []
  for val in dates:
    try:
      parsed.append(date.fromisoformat(str(val).split(" ")[0]))
    except Exception:
      continue
  return min(parsed) if parsed else date.today()


def sync_fx_for_currencies(conn, base: str, quotes: Iterable[str]) -> Dict[str, int]:
  """Descarga y guarda FX para las divisas indicadas respecto a base. Devuelve recuento por par."""
  base = (base or "").upper()
  summary: Dict[str, int] = {}
  for quote in set((q or "").upper() for q in quotes):
    if not quote or quote == base:
      continue
    start = _min_date_for_currency(conn, quote)
    today = date.today()
    symbol = f"{base}{quote}=X"
    rows = _fetch_yahoo_fx_history(symbol, start, today)
    inserted = 0
    for d, rate in rows:
      conn.execute(
        """INSERT INTO fx_rates(base_currency, quote_currency, date, rate)
           VALUES(?, ?, ?, ?)
           ON CONFLICT(base_currency, quote_currency, date) DO UPDATE SET rate=excluded.rate""",
        (base, quote, d.isoformat(), float(rate))
      )
      inserted += 1
    summary[f"{base}/{quote}"] = inserted
  conn.commit()
  return summary

