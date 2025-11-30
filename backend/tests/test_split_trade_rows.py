import sys
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from importer import (
  read_rows,
  is_stk_operation,
  is_opt_operation,
  is_dividend_operation,
  is_internal_transfer,
  process_internal_transfer,
  is_external_transfer,
  process_external_transfer,
)


def test_read_rows_switches_headers_and_maps_data(tmp_path):
  csv_content = """CurrencyPrimary,AssetClass,Symbol,Quantity
USD,STK,AAPL,10
"Model","CurrencyPrimary","FXRateToBase","AssetClass","SubCategory","Symbol","Description","Conid","SecurityID","SecurityIDType","CUSIP","ISIN","FIGI","ListingExchange","UnderlyingConid","UnderlyingSymbol","UnderlyingSecurityID","UnderlyingListingExchange","Issuer","IssuerCountryCode","Multiplier","Strike","Expiry","Put/Call","PrincipalAdjustFactor","Date/Time","SettleDate","AvailableForTradingDate","Amount","Type","TradeID","Code","TransactionID","ReportDate","ExDate","ClientReference","ActionID","LevelOfDetail","SerialNumber","DeliveryType","CommodityType","Fineness","Weight"
MyModel,USD,1.0,OPT, otro
MyModel_2,EUR,2.0,OPT, otro_
"""
  csv_file = tmp_path / "sample.csv"
  csv_file.write_text(csv_content, encoding="utf-8")

  rows = list(read_rows(csv_file))

  assert len(rows) == 3
  _, first = rows[0]
  _, second = rows[1]
  _, third = rows[2]
  assert first["CurrencyPrimary"] == "USD"
  assert first["AssetClass"] == "STK"
  assert second["Model"] == "MyModel"
  assert second["CurrencyPrimary"] == "USD"
  assert second["FXRateToBase"] == "1.0"

  assert third["Model"] == "MyModel_2"
  assert third["CurrencyPrimary"] == "EUR"
  assert third["FXRateToBase"] == "2.0"
  assert third["SubCategory"] == "otro_"
  


def test_upsert_trade_prefers_ibexecid_as_trade_id(tmp_path):
  # Usa read_rows para simular un CSV con cabecera primaria; IBExecID debe ser el trade_id.
  csv_content = """CurrencyPrimary,AssetClass,Symbol,Quantity,IBExecID,TradeID
USD,STK,AAPL,5,EXEC123,
"""
  csv_file = tmp_path / "sample.csv"
  csv_file.write_text(csv_content, encoding="utf-8")

  rows = list(read_rows(csv_file))
  _, first = rows[0]

  assert first["IBExecID"] == "EXEC123"
  assert "TradeID" in first  # presente pero vacío


def test_classifiers_detect_stk_opt_dividend_transfer():
  stk = {"AssetClass": "STK", "Symbol": "AAPL"}
  opt = {"AssetClass": "OPT", "Symbol": "AAPL  202401C100"}
  dividend = {"GrossAmount": "1.5", "PaymentDate": "2024-01-01", "Code": "PO"}
  cash = {"AssetClass": "CASH", "CurrencyPrimary": "USD"}
  other = {"AssetClass": "", "CurrencyPrimary": "USD"}

  assert is_stk_operation(stk)
  assert is_opt_operation(opt)
  assert is_dividend_operation(dividend)
  assert is_internal_transfer({"AssetClass": "CASH", "Symbol": "USD.EUR"})
  assert not is_stk_operation(other)
  assert not is_opt_operation(other)
  assert not is_dividend_operation(other)


def test_process_internal_transfer_inserts_two_rows(tmp_path):
  from db import ensure_schema, get_connection

  conn = get_connection(":memory:")
  ensure_schema(conn)
  row = {
    "TransactionID": "FX:1",
    "AssetClass": "CASH",
    "CurrencyPrimary": "USD",  # destino
    "Symbol": "USD.EUR",        # origen EUR
    "Quantity": "100",          # se venden 100 USD
    "TradePrice": "0.9",        # a 0.9 EUR/USD => se reciben 90 EUR
    "DateTime": "2024-01-01T00:00:00Z"
  }

  inserted = process_internal_transfer(conn, row)
  assert inserted == 2

  rows = conn.execute("SELECT transaction_id, currency, amount FROM transfers ORDER BY transaction_id").fetchall()
  assert len(rows) == 2
  # :out en origen EUR (se venden EUR), negativo; :in en destino USD, positivo
  out_row = [r for r in rows if r[0].endswith(":out")][0]
  in_row = [r for r in rows if r[0].endswith(":in")][0]
  assert out_row[1] == "EUR"
  assert in_row[1] == "USD"
  assert out_row[2] == -100
  assert in_row[2] == 90


def test_external_transfer_deposit_and_withdraw(tmp_path):
  from db import ensure_schema, get_connection

  conn = get_connection(":memory:")
  ensure_schema(conn)

  deposit = {
    "TransactionID": "EXT:1",
    "AssetClass": "CASH",
    "CurrencyPrimary": "USD",
    "Amount": "50",
    "DateTime": "2024-01-01T00:00:00Z",
    "Symbol": "USD",
    "Description": "CASH RECEIPTS DEPOSIT",
  }
  withdraw = {
    "TransactionID": "EXT:2",
    "AssetClass": "CASH",
    "CurrencyPrimary": "EUR",
    "Amount": "-20",
    "DateTime": "2024-01-02T00:00:00Z",
    "Symbol": "EUR",
    "Description": "CASH RECEIPTS WITHDRAW",
  }

  assert is_external_transfer(deposit)
  assert is_external_transfer(withdraw)

  inserted = process_external_transfer(conn, deposit) + process_external_transfer(conn, withdraw)
  assert inserted == 2

  rows = conn.execute("SELECT transaction_id, currency, amount, origin, kind FROM transfers ORDER BY transaction_id").fetchall()
  assert len(rows) == 2
  dep = rows[0]
  wdr = rows[1]
  assert dep[0] == "EXT:1" and dep[1] == "USD" and dep[2] == 50 and dep[4] == "deposito"
  assert wdr[0] == "EXT:2" and wdr[1] == "EUR" and wdr[2] == -20 and wdr[4] == "retiro"
