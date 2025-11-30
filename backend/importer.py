import argparse
import csv
import json
import logging
import os
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
  """
  Lee un CSV que puede traer varias cabeceras secuenciales:
  - Cabecera primaria (trades/FX): CurrencyPrimary, AssetClass, Symbol, Quantity, TradePrice, ...
  - Cabecera secundaria: Model, CurrencyPrimary, FXRateToBase, AssetClass...
  - Cabecera terciaria (cash/dividendos): Model, CurrencyPrimary, FXRateToBase, SubCategory, Symbol, Description...

  Cambia la cabecera activa cuando detecta cualquiera de las cabeceras conocidas.
  """
  with csv_path.open("r", newline="", encoding="utf-8-sig") as handle:
    reader = csv.reader(handle)
    headers: list[str] | None = None
    data_idx = 0
    secondary_header_prefix = ["Model", "CurrencyPrimary", "FXRateToBase"]
    tertiary_header_prefix = ["Model", "CurrencyPrimary", "FXRateToBase", "SubCategory"]

    for row in reader:
      # Normalizar valores a string recortada
      normalized = [str(value).strip() for value in row]
      if not any(normalized):
        continue
      if headers is None:
        headers = normalized
        continue
      if normalized[:len(tertiary_header_prefix)] == tertiary_header_prefix:
        headers = normalized
        continue
      if normalized[:len(secondary_header_prefix)] == secondary_header_prefix:
        headers = normalized
        continue

      if not headers:
        continue
      data = {}
      for i, header in enumerate(headers):
        if i < len(normalized):
          data[header] = normalized[i]
      yield data_idx, data
      data_idx += 1


def configure_logging_from_args(args):
  """
  Configura logging global usando BACKEND_LOG_PATH (via .env) o --log si se pasa.
  """
  if args.log:
    os.environ["BACKEND_LOG_PATH"] = str(Path(args.log).expanduser())
  load_dotenv()
  configure_root_logging()


def iter_inputs(args):
  """Construye la lista de inputs a procesar (payload JSON o archivos CSV)."""
  inputs = []
  payload_path = Path(args.payload).expanduser() if args.payload else None
  if payload_path:
    if payload_path.exists():
      inputs.append(("payload", payload_path))
    else:
      logging.warning("El payload %s no existe; se omite.", payload_path)
  for file_path_str in args.files:
    csv_path = Path(file_path_str).expanduser()
    inputs.append(("file", csv_path))
  return inputs


def ensure_db(conn_path: Path):
  """Abre conexión SQLite y asegura el esquema."""
  conn = get_connection(str(conn_path))
  ensure_schema(conn)
  return conn


def insert_batch(conn, kind: str, path_obj: Path, now_iso: str):
  """Inserta un registro en import_batches y devuelve el id."""
  batch = conn.execute(
    "INSERT INTO import_batches (kind, file_path, imported_at) VALUES (?, ?, ?)",
    (kind, str(path_obj), now_iso)
  )
  return batch.lastrowid

def is_stk_operation(data: Dict[str, Any]) -> bool:
  asset_class = str(data.get("AssetClass") or data.get("assetClass") or "").upper()
  code = str(data.get("Code") or "").upper()
  if (asset_class == "STK") and (code == ""):
    return True
  
  return False  # una STK pura no trae UnderlyingSymbol


def is_opt_operation(data: Dict[str, Any]) -> bool:
  asset_class = str(data.get("AssetClass") or data.get("assetClass") or "").upper()
  return asset_class == "OPT"


def is_dividend_operation(data: Dict[str, Any]) -> bool:
  description = str(data.get("Description") or data.get("descripcion") or "").upper()
  code = str(data.get("Code") or "").upper()
  logging.info(f"Analizando el Dividendo de: { json.dumps(data,ensure_ascii=False, indent=2)}")
  if ("PO" in code.upper()):
    logging.info(f"Nuevo Dividendo: {data}")
    return True

  return False
  

def is_internal_transfer(data: Dict[str, Any]) -> bool:
  """
  Detecta transferencias internas/FX (mismo owner):
  - AssetClass CASH con símbolo de par "USD.EUR"
  - TransactionID con prefijo FX:
  - Descripción que menciona FX transfer
  """
  asset_class = str(data.get("AssetClass") or data.get("assetClass") or "").upper()
  symbol = str(data.get("Symbol") or data.get("Ticker") or "").upper()
  if asset_class == "CASH" and "." in symbol:
    return True
  return False


def is_external_transfer(data: Dict[str, Any]) -> bool:
  """
  Detecta transferencias externas de efectivo (depósitos/retiros):
  - La descripción contiene "CASH RECEIPTS" (CSV sección secundaria)
  """
  description = str(data.get("Description") or data.get("descripcion") or "").upper()
  if "CASH RECEIPTS" in description:
    logging.info(f"Nueva Transfer externa: {data}")
    return True
 
  return False

def insert_transfer_entry(conn, tx_id: str, currency: str, dt_iso: str, amount: float, origin: str, kind: str, raw: Dict[str, Any]):
  cur = conn.execute(
    """INSERT OR IGNORE INTO transfers (transaction_id, currency, datetime, amount, origin, kind, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)""",
    (tx_id, currency, dt_iso, amount, origin, kind, json.dumps(raw, ensure_ascii=False, default=str))
  )
  return cur.rowcount > 0


def process_internal_transfer(conn, data: Dict[str, Any]) -> int:
  """
  Inserta dos movimientos (salida/entrada) para una transferencia interna con FX.
  """
  tx_id = extract_transaction_id(data)
  dest_currency = str(data.get("CurrencyPrimary") or data.get("Currency") or "").strip().upper()
  symbol = str(data.get("Symbol") or data.get("Ticker") or "").upper()
  dt_iso = parse_datetime(data.get("Date/Time") or data.get("DateTime") or data.get("Date"))
  qty = parse_float(data.get("Quantity")) or parse_float(data.get("Amount"))
  price = parse_float(data.get("TradePrice") or data.get("Price") or data.get("FXRateToBase") or data.get("FXRate") or data.get("Rate"))
  if not tx_id or not dest_currency or qty is None or not dt_iso:
    return 0

  parts = symbol.split(".") if symbol else []
  origin_currency = None
  if len(parts) == 2:
    if parts[0].upper() == dest_currency:
      origin_currency = parts[1].upper()
    else:
      origin_currency = parts[0].upper()

  inserted = 0
  dest_amount = -abs(qty)
  if insert_transfer_entry(conn, f"{tx_id}:out", origin_currency, dt_iso, dest_amount, "fx_interno", "retiro", data):
    inserted += 1

  if origin_currency:
    origin_amount = abs(qty)
    if price:
      origin_amount = abs(qty) * price
    if insert_transfer_entry(conn, f"{tx_id}:in", dest_currency, dt_iso, origin_amount, "fx_interno", "deposito", data):
      inserted += 1
  return inserted


def process_external_transfer(conn, data: Dict[str, Any]) -> int:
  """
  Inserta una transferencia externa (depósito/retiro) en `transfers`.
  """
  tx_id = extract_transaction_id(data)
  currency = str(data.get("CurrencyPrimary") or data.get("Currency") or "").strip().upper()
  dt_iso = parse_datetime(data.get("Date/Time") or data.get("DateTime") or data.get("Date"))
  amount = parse_float(data.get("Amount")) if data.get("Amount") is not None else parse_float(data.get("Quantity"))
  if not tx_id or not currency or amount is None or not dt_iso:
    return 0
  origin = "externo"
  kind = "deposito" if amount > 0 else "retiro"
  return int(insert_transfer_entry(conn, tx_id, currency, dt_iso, amount, origin, kind, data))


def process_rows(conn, batch_id: int, rows: list[Tuple[int, Dict[str, Any]]]):
  """
  Inserta filas en import_rows y procesa cada una en función de su contenido:
  - STK/OPT -> trades
  - Dividendos (campos Payment/Gross/Tax/ActionID) -> dividends
  - CASH u otros -> transfers
  Filas con clave Description/Descripcion se guardan pero no se procesan.
  """
  total = 0
  inserted_transfers = 0
  inserted_trades = 0
  inserted_dividends = 0
  # logging.info(f"Procesando ROWS")
  # logging.info(f"Primera: {json.dumps(rows[0], ensure_ascii=False, indent=2)}")
  # logging.info(f"MEdia: {json.dumps(rows[380], ensure_ascii=False, indent=2)}")
  # logging.info(f"Ultima: {json.dumps(rows[-1], ensure_ascii=False, indent=2)}")

  for row_index, data in rows:
    conn.execute(
      "INSERT INTO import_rows (batch_id, row_index, data) VALUES (?, ?, ?)",
      (batch_id, row_index, json.dumps(data, ensure_ascii=False, default=str))
    )
    total += 1

    if is_external_transfer(data):
      logging.info(f"Procesndo external Transfer: {json.dumps(data, ensure_ascii=False, default=str, indent=2)}")
      inserted_transfers += process_external_transfer(conn, data)
      continue

    if is_stk_operation(data) or is_opt_operation(data):
      if upsert_trade(conn, data):
        inserted_trades += 1
      continue

    if is_dividend_operation(data):
      if upsert_dividend(conn, data):
        inserted_dividends += 1
      continue

    if is_internal_transfer(data):
      inserted_transfers += process_internal_transfer(conn, data)
      continue






  conn.execute("UPDATE import_batches SET total_rows = ? WHERE id = ?", (total, batch_id))
  conn.commit()
  return inserted_transfers, inserted_trades, inserted_dividends, total


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
  candidates = ["TransactionID", "TransactionId", "TradeID", "IBExecID", "ID", "Id"]
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


def upsert_trade(conn, row: Dict[str, Any]) -> bool:
  asset_class = str(row.get("AssetClass") or row.get("assetClass") or row.get("Asset") or "").strip().upper()
  if asset_class not in {"STK", "OPT"}:
    return False
  trade_id = str(row.get("TradeID") or row.get("IBExecID") or row.get("trade_id") or "").strip()
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
  
  currency = str(row.get("CurrencyPrimary") or "").strip().upper()
  if not currency:
    return False
  
  dt_iso = parse_datetime(row.get("PayDate"))
  if not dt_iso:
    return False
  
  ticker = str(row.get("Symbol") or "").strip().upper()
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
  """Orquesta la importación: logging, DB, inputs y procesamiento por lote."""
  args = parse_args()
  configure_logging_from_args(args)
  logging.info("importer.py: importando datos")

  # Preparar base de datos
  db_path = Path(args.db)
  db_path.parent.mkdir(parents=True, exist_ok=True)
  conn = ensure_db(db_path)
  if args.init_only:
    logging.info("Inicialización solicitada; esquema asegurado en %s", db_path)
    conn.close()
    return

  # Resolver inputs (archivos o payload)
  inputs = iter_inputs(args)
  if not inputs:
    logging.warning("No se encontraron orígenes válidos para importar.")
    conn.close()
    return

  # Procesar cada origen y registrar batch
  kind = str(args.kind or "").strip().lower()
  now_iso = datetime.now(timezone.utc).isoformat()

  logging.info(f"Procesar cada origen y registrar batch: {kind}")
  for source_type, path_obj in inputs:
    if source_type == "file":
      if not path_obj.exists():
        logging.warning("El archivo %s no existe; se omite.", path_obj)
        continue
      iterator = read_rows(path_obj)
    else:
      try:
        data_list = json.loads(path_obj.read_text(encoding="utf-8"))
      except Exception:
        logging.warning("Payload %s ilegible; se omite.", path_obj)
        continue
      if not isinstance(data_list, list):
        logging.warning("Payload %s no es una lista; se omite.", path_obj)
        continue
      iterator = [(idx, row) for idx, row in enumerate(data_list) if isinstance(row, dict)]

    rows_cache = list(iterator)
    # logging.info(f"Primera: {json.dumps(rows_cache[0], ensure_ascii=False, indent=2)}")
    # logging.info(f"MEdia: {json.dumps(rows_cache[380], ensure_ascii=False, indent=2)}")
    # logging.info(f"Ultima: {json.dumps(rows_cache[-1], ensure_ascii=False, indent=2)}")

    if not rows_cache:
      logging.warning("Origen %s sin filas; se omite.", path_obj)
      continue

    logging.info("Iniciando importación | kind=%s | origen=%s | filas=%s", kind or args.kind, path_obj, len(rows_cache))
    batch_id = insert_batch(conn, kind, path_obj, now_iso)
    inserted_transfers, inserted_trades, inserted_dividends, total = process_rows(conn, batch_id, rows_cache)
    logging.info(
      "Importación finalizada | lote=%s | filas=%s | nuevas_transfers=%s | nuevas_trades=%s | nuevas_dividends=%s | archivo=%s",
      batch_id,
      total,
      inserted_transfers,
      inserted_trades,
      inserted_dividends,
      path_obj
    )
  conn.close()


if __name__ == "__main__":
  main()
