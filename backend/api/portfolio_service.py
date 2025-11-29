import logging
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException


def _record_missing(missing_data: Optional[Dict[str, set]], key: str, value) -> None:
  if missing_data is None:
    return
  missing_data.setdefault(key, set()).add(value)


def _parse_db_datetime(value: str) -> Optional[date]:
  if not value:
    return None
  try:
    return date.fromisoformat(value.split(' ')[0])
  except Exception:
    return None


def _parse_date(value: Optional[str]) -> Optional[date]:
  if not value:
    return None
  try:
    return date.fromisoformat(value)
  except ValueError:
    raise HTTPException(status_code=400, detail='Fecha inválida, use YYYY-MM-DD')


def _period_end_for(d: date, interval: str) -> date:
  if interval == 'day':
    return d
  if interval == 'week':
    start = d - timedelta(days=d.weekday())
    return start + timedelta(days=6)
  if interval == 'month':
    next_month = d.replace(day=28) + timedelta(days=4)
    return next_month - timedelta(days=next_month.day)
  if interval == 'quarter':
    quarter = (d.month - 1) // 3
    end_month = (quarter + 1) * 3
    end_month_start = date(d.year, end_month, 1)
    next_month = end_month_start.replace(day=28) + timedelta(days=4)
    return next_month - timedelta(days=next_month.day)
  if interval == 'year':
    return date(d.year, 12, 31)
  raise HTTPException(status_code=400, detail='Intervalo inválido, use day|week|month|quarter|year')


def fx_rate_on_date(conn, base: str, quote: str, target: date) -> Optional[float]:
  if not base or not quote:
    return None
  if base.upper() == quote.upper():
    return 1.0
  cur = conn.execute(
    """SELECT rate FROM fx_rates
       WHERE base_currency = ? AND quote_currency = ? AND date <= ?
       ORDER BY date DESC LIMIT 1""",
    (base.upper(), quote.upper(), target.isoformat())
  )
  row = cur.fetchone()
  return float(row[0]) if row else None


def convert_amount_on_date(conn, amount: float, from_currency: str, base_currency: str, target: date, *, missing_data: Optional[Dict[str, set]] = None, allow_missing: bool = False) -> Optional[float]:
  rate = fx_rate_on_date(conn, base_currency, from_currency, target)
  if rate is None:
    if allow_missing:
      _record_missing(missing_data, 'fx', (target.isoformat(), base_currency.upper(), from_currency.upper()))
      return None
    raise HTTPException(status_code=400, detail=f'No hay tipo de cambio para {from_currency}->{base_currency} en {target.isoformat()}')
  return amount * rate


def collect_trades_and_cash(conn) -> Tuple[Dict[str, List[Tuple[date, float, str, float]]], Dict[str, str], Dict[date, Dict[str, float]]]:
  trades: Dict[str, List[Tuple[date, float, str, float]]] = {}
  ticker_currency: Dict[str, str] = {}
  cash_movements: Dict[date, Dict[str, float]] = {}
  cur = conn.execute("SELECT ticker, quantity, datetime, currency, purchase FROM trades ORDER BY datetime ASC")
  for ticker, qty, dt_str, currency, purchase in cur.fetchall():
    if not ticker or qty is None:
      continue
    d = _parse_db_datetime(dt_str)
    if not d:
      continue
    purchase_price = float(purchase or 0)
    trades.setdefault(ticker, []).append((d, float(qty), (currency or '').upper(), purchase_price))
    cash_movements.setdefault(d, {})
    cash_movements[d][(currency or '').upper()] = cash_movements[d].get((currency or '').upper(), 0.0) - float(qty) * purchase_price
    if ticker not in ticker_currency and currency:
      ticker_currency[ticker] = (currency or '').upper()
  return trades, ticker_currency, cash_movements


def build_value_by_date(conn, trades: Dict[str, List[Tuple[date, float, str, float]]], ticker_currency: Dict[str, str], base_currency: str, missing_data: Optional[Dict[str, set]] = None) -> Dict[date, float]:
  value_by_date: Dict[date, float] = {}
  for ticker, rows in trades.items():
    price_rows = conn.execute(
      "SELECT date, close FROM prices WHERE ticker = ? ORDER BY date ASC",
      (ticker,)
    ).fetchall()
    if not price_rows:
      if rows and missing_data is not None:
        trade_date = rows[0][0]
        _record_missing(missing_data, 'prices', (trade_date.isoformat(), ticker))
      continue
    ticker_trades = rows
    trade_idx = 0
    qty = 0.0
    currency = ticker_currency.get(ticker) or base_currency
    for date_str, close in price_rows:
      try:
        price_date = date.fromisoformat(date_str)
      except ValueError:
        continue
      while trade_idx < len(ticker_trades) and ticker_trades[trade_idx][0] <= price_date:
        qty += float(ticker_trades[trade_idx][1])
        trade_idx += 1
      if qty == 0:
        continue
      value = qty * float(close)
      converted = convert_amount_on_date(conn, value, currency, base_currency, price_date, missing_data=missing_data, allow_missing=True)
      if converted is None:
        continue
      value_by_date[price_date] = value_by_date.get(price_date, 0.0) + converted
  return value_by_date


def collect_transfers_and_cash(conn, base_currency: str, cash_movements: Dict[date, Dict[str, float]], missing_data: Optional[Dict[str, set]] = None) -> Tuple[Dict[date, float], Dict[date, Dict[str, float]]]:
  """
  Combina transferencias externas (para transfers_base) y flujos de caja por divisa.
  - `cash_movements` se pasa como deltas (p. ej. compras/ventas de trades).
  - Devuelve saldos acumulados de caja por fecha y transferencias externas convertidas a base.
  """
  transfer_by_date: Dict[date, float] = {}
  raw_cash = dict(cash_movements)
  cur = conn.execute("SELECT currency, datetime, amount, origin FROM transfers ORDER BY datetime ASC")
  for currency, dt_str, amount, origin in cur.fetchall():
    d = _parse_db_datetime(dt_str)
    if not d:
      continue
    cur_code = (currency or '').upper()
    amt = float(amount or 0)
    raw_cash.setdefault(d, {})
    raw_cash[d][cur_code] = raw_cash[d].get(cur_code, 0.0) + amt
    if origin == 'externo':
      converted = convert_amount_on_date(conn, amt, cur_code, base_currency, d, missing_data=missing_data, allow_missing=True)
      if converted is not None:
        transfer_by_date[d] = transfer_by_date.get(d, 0.0) + converted
  # Convertir deltas en saldos acumulados por divisa
  cash_balances: Dict[date, Dict[str, float]] = {}
  running: Dict[str, float] = {}
  for day in sorted(raw_cash.keys()):
    for cur_code, delta in raw_cash[day].items():
      running[cur_code] = running.get(cur_code, 0.0) + delta
    cash_balances[day] = dict(running)
  return transfer_by_date, cash_balances


def build_buckets(from_d: Optional[date], to_d: Optional[date], interval: str, value_by_date: Dict[date, float], transfer_by_date: Dict[date, float], cash_movements: Dict[date, Dict[str, float]]):
  all_dates = [d for d in (set(value_by_date.keys()) | set(transfer_by_date.keys()) | set(cash_movements.keys())) if (not from_d or d >= from_d) and (not to_d or d <= to_d)]
  if not all_dates:
    return {}
  min_date = min(all_dates)
  max_date = max(all_dates)
  if to_d and to_d > max_date:
    max_date = to_d
  buckets: Dict[date, Dict[str, Any]] = {}
  cash_balance: Dict[str, float] = {}
  current = min_date
  while current <= max_date:
    bucket_end = _period_end_for(current, interval)
    bucket = buckets.setdefault(bucket_end, {'transfers': 0.0, 'value': None, 'has_value': False, 'cash': {}})
    if current in transfer_by_date:
      bucket['transfers'] += transfer_by_date[current]
    if current in value_by_date:
      bucket['value'] = value_by_date[current]
      bucket['has_value'] = True
    if current in cash_movements:
      cash_balance = dict(cash_movements[current])
    bucket['cash'] = dict(cash_balance)
    if interval == 'day':
      current += timedelta(days=1)
    else:
      future = [d for d in all_dates if d > current]
      current = min(future) if future else max_date + timedelta(days=1)
  return buckets


def build_series_from_buckets(conn, buckets: Dict[date, Dict[str, Any]], base_currency: str, missing_data: Optional[Dict[str, set]] = None):
  out = []
  cumulative_transfers = 0.0
  last_positions_value = 0.0
  for bucket_end in sorted(buckets.keys()):
    bucket = buckets[bucket_end]
    cumulative_transfers += bucket['transfers']
    if bucket['has_value']:
      last_positions_value = float(bucket['value'] or 0.0)
    cash_map = {}
    cash_base_map = {}
    for cur_code, bal in bucket.get('cash', {}).items():
      cash_map[cur_code] = bal
      converted_cash = convert_amount_on_date(conn, bal, cur_code, base_currency, bucket_end, missing_data=missing_data, allow_missing=True)
      if converted_cash is None:
        continue
      cash_base_map[cur_code] = converted_cash
    cash_total_base = sum(cash_base_map.values())
    total_value = last_positions_value + cash_total_base
    base_capital = max(0.0, cumulative_transfers)
    pnl_pct = total_value / base_capital * 100 if base_capital > 0 else 0.0
    out.append({
      'date': bucket_end.isoformat(),
      'value_base': total_value,
      'transfers_base': bucket['transfers'],
      'pnl_pct': pnl_pct,
      'cash': cash_map,
      'cash_base': cash_base_map
    })
  return out


def schedule_missing_data_sync(missing_data: Dict[str, set]) -> bool:
  """
  Placeholder de orquestación: registra faltantes para que un proceso de sync los atienda.
  Retorna True si hay faltantes que requieren sincronización.
  """
  has_work = bool(missing_data.get('fx') or missing_data.get('prices'))
  if not has_work:
    return False
  logging.info("Programando sync de datos faltantes: %s", missing_data)
  return True
