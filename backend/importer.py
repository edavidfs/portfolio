import argparse
import csv
import json
import logging
from logging_config import configure_root_logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Tuple

try:
  from dotenv import load_dotenv
except ImportError:
  def load_dotenv():
    return False

from db import ensure_schema, get_connection
try:
  from dotenv import load_dotenv
except ImportError:
  def load_dotenv():
    return False


def parse_args():
  parser = argparse.ArgumentParser(description="Importa archivos CSV y los almacena en SQLite.")
  parser.add_argument("--db", required=True, help="Ruta al archivo SQLite destino.")
  parser.add_argument("--kind", required=True, help="Tipo de datos (trades, transfers, dividends, etc.).")
  parser.add_argument("--log", required=False, help="Ruta al archivo de log para depuración.", default=None)
  parser.add_argument("--init-only", action="store_true", help="Solo asegura que la BD y el esquema existan.")
  parser.add_argument("--payload", required=False, help="Ruta a un archivo JSON con filas ya parseadas.")
  parser.add_argument("files", nargs="*", help="Listado de archivos CSV a importar.")
  return parser.parse_args()


def read_rows(csv_path: Path) -> Iterable[Tuple[int, Dict[str, Any]]]:
  with csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
    reader = csv.DictReader(handle)
    for idx, row in enumerate(reader):
      if not any(str(value).strip() for value in row.values()):
        continue
      yield idx, row


def read_payload_rows(payload_path: Path) -> Iterable[Tuple[int, Dict[str, Any]]]:
  try:
    data = json.loads(payload_path.read_text(encoding="utf-8"))
  except Exception:
    return []
  if not isinstance(data, list):
    return []
  for idx, row in enumerate(data):
    if isinstance(row, dict):
      yield idx, row


def split_trade_rows(rows: Iterable[Tuple[int, Dict[str, Any]]]):
  """
  Divide filas de trades en dos grupos:
  - primarias: compras/ventas/FX con cabecera corta (CurrencyPrimary, AssetClass, Symbol, Quantity, TradePrice, Buy/Sell, IBExecID, etc.).
  - secundarias: cabecera extendida (Model, FXRateToBase, Description...) que se procesarán más adelante.
  """
  primary = []
  secondary = []
  for row_index, data in rows:
    if any(key in data for key in ("Model", "FXRateToBase", "Description", "LevelOfDetail", "DeliveryType")):
      secondary.append((row_index, data))
    else:
      primary.append((row_index, data))
  return primary, secondary


def parse_datetime(raw: Any):
  if raw is None:
    return None
  if isinstance(raw, (int, float)):
    try:
      return datetime.fromtimestamp(float(raw), tz=timezone.utc).isoformat()
    except (ValueError, OSError):
      return None
  clean = str(raw).replace(";", " ").strip()
  if not clean:
    return None
  iso_candidates = [clean]
  if clean.endswith("Z"):
    iso_candidates.append(clean[:-1] + "+00:00")
  for candidate in iso_candidates:
    try:
      dt = datetime.fromisoformat(candidate)
      if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
      return dt.isoformat()
    except ValueError:
      continue
  for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
    try:
      dt = datetime.strptime(clean, fmt)
      dt = dt.replace(tzinfo=timezone.utc)
      return dt.isoformat()
    except ValueError:
      continue
  parts = clean.split()
  date_part = parts[0]
  time_part = parts[1] if len(parts) > 1 else ""
  try:
    day, month, year = [int(x) for x in date_part.split("/")]
  except ValueError:
    return None
  hours = minutes = seconds = 0
  if time_part:
    tokens = time_part.split(":")
    hours = int(tokens[0]) if len(tokens) > 0 and tokens[0].isdigit() else 0
    minutes = int(tokens[1]) if len(tokens) > 1 and tokens[1].isdigit() else 0
    seconds = int(tokens[2]) if len(tokens) > 2 and tokens[2].isdigit() else 0
  try:
    dt = datetime(year, month, day, hours, minutes, seconds, tzinfo=timezone.utc)
  except ValueError:
    return None
  return dt.isoformat()


def parse_float(value: Any):
  if value is None:
    return None
  try:
    return float(str(value).replace(",", "."))
  except ValueError:
    return None


def extract_transaction_id(row: Dict[str, Any]):
  candidates = ["TransactionID", "TransactionId", "TradeID", "ID", "Id"]
  for key in candidates:
    val = row.get(key)
    if val:
      text = str(val).strip()
      if text:
        return text
  return None


def extract_action_id(row: Dict[str, Any]):
  candidates = ["ActionID", "ActionId", "ID", "Id", "action_id"]
  for key in candidates:
    val = row.get(key)
    if val:
      text = str(val).strip()
      if text:
        return text
  return None


def classify_transfer(row: Dict[str, Any], tx_id: str) -> Tuple[str, str]:
  tx_upper = (tx_id or "").upper()
  # Prefijos conocidos para ignorar operaciones o FX internos
  if tx_upper.startswith("FX:"):
    return "fx_interno", "mov_interno"
  if tx_upper.startswith("STK:"):
    return "operacion_stk", "operacion"
  if tx_upper.startswith("OPT:"):
    # Prima de opciones: flujo de caja
    amount = parse_float(row.get("Amount")) or 0
    kind = "deposito" if amount > 0 else "retiro"
    return "operacion_opt", kind
  # Revisar campos de Asset/AssetClass
  asset_class = str(row.get("AssetClass") or row.get("Asset") or row.get("assetClass") or "").upper()
  if asset_class == "STK":
    return "operacion_stk", "operacion"
  if asset_class == "OPT":
    amount = parse_float(row.get("Amount")) or 0
    kind = "deposito" if amount > 0 else "retiro"
    return "operacion_opt", kind
  if asset_class == "CASH":
    symbol = str(row.get("Ticker") or row.get("Symbol") or "").upper()
    if "." in symbol:
      return "fx_interno", "mov_interno"
  # Descripción
  activity = str(row.get("ActivityDescription") or row.get("Description") or "").upper()
  if "FX" in activity and "TRANSFER" in activity:
    return "fx_interno", "mov_interno"
  # Por defecto, externo. Tipo según signo
  amount = parse_float(row.get("Amount")) or 0
  kind = "deposito" if amount > 0 else "retiro"
  return "externo", kind


def upsert_transfer(conn, row: Dict[str, Any]) -> bool:
  tx_id = extract_transaction_id(row)
  if not tx_id:
    return False
  currency = str(row.get("CurrencyPrimary") or row.get("Currency") or "").strip().upper()
  if not currency:
    return False
  dt_iso = parse_datetime(row.get("Date/Time") or row.get("DateTime") or row.get("Date"))
  if not dt_iso:
    return False
  amount = parse_float(row.get("Amount"))
  if amount is None:
    amount = parse_float(row.get("Quantity"))
  if amount is None:
    return False
  origin, kind = classify_transfer(row, tx_id)
  if origin.startswith("operacion"):
    # No se guardan flujos de operaciones (STK/OPT) en transfers
    return False
  before = conn.total_changes
  conn.execute(
    """INSERT OR IGNORE INTO transfers (transaction_id, currency, datetime, amount, origin, kind, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)""",
    (tx_id, currency, dt_iso, amount, origin, kind, json.dumps(row, ensure_ascii=False, default=str))
  )
  return conn.total_changes > before


def upsert_trade(conn, row: Dict[str, Any]) -> bool:
  asset_class = str(row.get("AssetClass") or row.get("assetClass") or row.get("Asset") or "").strip().upper()
  if asset_class not in {"STK", "OPT"}:
    return False
  trade_id = str(row.get("TradeID") or row.get("trade_id") or "").strip()
  ticker = str(row.get("Ticker") or row.get("ticker") or row.get("Symbol") or "").strip().upper()
  qty = parse_float(row.get("Quantity") or row.get("quantity"))
  price = parse_float(row.get("PurchasePrice") or row.get("purchase") or row.get("purchasePrice") or row.get("Price") or row.get("TradePrice"))
  dt_raw = row.get("DateTime") or row.get("dateTime") or row.get("Date")
  dt_iso = None
  if dt_raw:
    if isinstance(dt_raw, str):
      if "T" in dt_raw:
        dt_iso = dt_raw
      else:
        dt_iso = parse_datetime(dt_raw)
    else:
      dt_iso = parse_datetime(dt_raw)
  commission = parse_float(row.get("Commission") or row.get("commission"))
  comm_currency = (row.get("CommissionCurrency") or row.get("commissionCurrency") or row.get("CommissionCurrency") or "").strip().upper()
  currency = (row.get("CurrencyPrimary") or row.get("currencyPrimary") or row.get("Currency") or "").strip().upper()
  isin = str(row.get("ISIN") or row.get("isin") or "").strip().upper()
  if not trade_id:
    if not ticker or qty is None or price is None:
      return False
    trade_id = f"{ticker}|{qty}|{price}"
  before = conn.total_changes
  conn.execute(
    """INSERT OR IGNORE INTO trades (trade_id, ticker, quantity, purchase, datetime, commission,
       commission_currency, currency, isin, asset_class, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
    (
      trade_id,
      ticker or None,
      qty,
      price,
      dt_iso,
      commission,
      comm_currency or None,
      currency or None,
      isin or None,
      asset_class or None,
      json.dumps(row, ensure_ascii=False, default=str)
    )
  )
  return conn.total_changes > before


def upsert_dividend(conn, row: Dict[str, Any]) -> bool:
  action_id = extract_action_id(row)
  if not action_id:
    return False
  currency = str(row.get("CurrencyPrimary") or row.get("Currency") or row.get("currency") or "").strip().upper()
  if not currency:
    return False
  dt_iso = parse_datetime(
    row.get("Date/Time") or row.get("DateTime") or row.get("PaymentDate") or row.get("Payment Date") or row.get("Date") or row.get("datetime")
  )
  if not dt_iso:
    return False
  ticker = str(row.get("Ticker") or row.get("Symbol") or row.get("Underlying") or row.get("Asset") or row.get("ticker") or "").strip().upper()
  gross = parse_float(row.get("GrossAmount") or row.get("grossAmount") or row.get("gross"))
  tax = parse_float(row.get("Tax") or row.get("tax"))
  amount = parse_float(row.get("Amount") or row.get("amount"))
  if amount is None and gross is not None:
    amount = gross + (tax or 0)
  if amount is None:
    return False
  issuer_country = str(row.get("IssuerCountryCode") or row.get("Country") or row.get("issuer_country") or "").strip().upper() or None
  before = conn.total_changes
  conn.execute(
    """INSERT OR IGNORE INTO dividends (action_id, ticker, currency, datetime, amount, gross, tax, issuer_country, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
    (
      action_id,
      ticker or None,
      currency,
      dt_iso,
      amount,
      gross,
      tax,
      issuer_country,
      json.dumps(row, ensure_ascii=False, default=str)
    )
  )
  return conn.total_changes > before


def main():
  load_dotenv()
  configure_root_logging()
  logging.info("importer.py: importando datos")
  args = parse_args()
  db_path = Path(args.db)
  db_path.parent.mkdir(parents=True, exist_ok=True)
  if args.log:
    log_path = Path(args.log).expanduser()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=str(log_path), level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s", filemode='a')
  conn = get_connection(str(db_path))
  ensure_schema(conn)
  if args.init_only:
    logging.info("Inicialización solicitada; esquema asegurado en %s", db_path)
    return
  if not args.files and not args.payload:
    logging.warning("No se proporcionaron archivos ni payloads para importar.")
    return
  kind = str(args.kind or "").strip().lower()
  now_iso = datetime.now(timezone.utc).isoformat()
  inputs = []
  payload_path = Path(args.payload).expanduser() if args.payload else None
  if payload_path:
    if not payload_path.exists():
      logging.warning("El payload %s no existe; se omite.", payload_path)
    else:
      inputs.append(("payload", payload_path))
  for file_path_str in args.files:
    csv_path = Path(file_path_str).expanduser()
    inputs.append(("file", csv_path))
  if not inputs:
    logging.warning("No se encontraron orígenes válidos para importar.")
    return
  for source_type, path_obj in inputs:
    if source_type == "file":
      if not path_obj.exists():
        logging.warning("El archivo %s no existe; se omite.", path_obj)
        continue
      iterator = read_rows(path_obj)
    else:
      iterator = read_payload_rows(path_obj)
    logging.info("Iniciando importación | kind=%s | origen=%s", kind or args.kind, path_obj)
    batch = conn.execute(
      "INSERT INTO import_batches (kind, file_path, imported_at) VALUES (?, ?, ?)",
      (kind or args.kind, str(path_obj), now_iso)
    )
    batch_id = batch.lastrowid
    total = 0
    inserted_transfers = 0
    inserted_trades = 0
    inserted_dividends = 0
    rows_cache = list(iterator)
    if kind == "trades":
      rows_to_process, rows_secondary = split_trade_rows(rows_cache)
    else:
      rows_to_process, rows_secondary = rows_cache, []

    for row_index, data in rows_to_process:
      conn.execute(
        "INSERT INTO import_rows (batch_id, row_index, data) VALUES (?, ?, ?)",
        (batch_id, row_index, json.dumps(data, ensure_ascii=False, default=str))
      )
      total += 1
      if kind == "transfers":
        if upsert_transfer(conn, data):
          inserted_transfers += 1
      elif kind == "trades":
        if upsert_trade(conn, data):
          inserted_trades += 1
        else:
          # Si no es STK/OPT, intentar guardarlo como transferencia (fx/cash)
          upsert_transfer(conn, data)
      elif kind == "dividends":
        if upsert_dividend(conn, data):
          inserted_dividends += 1
    # Registrar también el lote secundario en import_rows (sin procesar aún)
    for row_index, data in rows_secondary:
      conn.execute(
        "INSERT INTO import_rows (batch_id, row_index, data) VALUES (?, ?, ?)",
        (batch_id, row_index, json.dumps(data, ensure_ascii=False, default=str))
      )
      total += 1
    conn.execute("UPDATE import_batches SET total_rows = ? WHERE id = ?", (total, batch_id))
    conn.commit()
    logging.info(
      "Importación finalizada | lote=%s | filas=%s | nuevas_transfers=%s | nuevas_trades=%s | nuevas_dividends=%s | archivo=%s",
      batch_id,
      total,
      inserted_transfers if kind == "transfers" else "-",
      inserted_trades if kind == "trades" else "-",
      inserted_dividends if kind == "dividends" else "-",
      path_obj
    )


if __name__ == "__main__":
  main()
