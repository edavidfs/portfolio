import { Injectable, signal } from '@angular/core';
import { ToastService } from './toast.service';

declare const Chart: any;
declare const Papa: any;
declare const initSqlJs: any;

export interface TradeRow { TradeID?: string; Ticker: string; Quantity: number; PurchasePrice: number; DateTime?: Date|null; Commission?: number; CommissionCurrency?: string; CurrencyPrimary?: string; ISIN?: string; AssetClass?: string; }
export interface TransferRow { TransactionID: string; DateTime: Date; Amount: number; CurrencyPrimary: string; }
export interface DividendRow { ActionID: string; DateTime: Date; Amount: number; CurrencyPrimary: string; Ticker?: string; Tax: number; IssuerCountryCode?: string; }
export interface OptionRow {
  OptionID: string;
  underlying: string;
  symbol: string;
  side: 'BUY'|'SELL'|'UNKNOWN';
  contracts: number;
  tradePrice: number;
  multiplier: number;
  premiumGross: number;
  commission: number;
  commissionCurrency?: string;
  currencyPrimary: string;
  DateTime: Date;
  execId?: string;
  expiry?: Date;
  optType?: 'C'|'P';
  strike?: number;
  calcMultiplier?: number;
  notional?: number;
}

@Injectable({providedIn: 'root'})
export class DataService {
  trades = signal<TradeRow[]>([]);
  transfers = signal<TransferRow[]>([]);
  dividends = signal<DividendRow[]>([]);
  options = signal<OptionRow[]>([]);

  private tradeKeys = new Set<string>();
  private tradeIds = new Set<string>();
  private transferIds = new Set<string>();
  private dividendIds = new Set<string>();
  private priceErrorShown = new Set<string>();
  private alphaApiKey: string | null = null;
  private finnhubApiKey: string | null = null;
  private priceProvider: 'alpha' | 'finnhub' = 'alpha';
  private finnhubSymbolMap: Record<string, string> = {};

  constructor(private toast: ToastService) {
    try {
      this.alphaApiKey = localStorage.getItem('alphaVantageKey');
      this.finnhubApiKey = localStorage.getItem('finnhubKey');
      const prov = localStorage.getItem('priceProvider');
      if (prov === 'finnhub' || prov === 'alpha') this.priceProvider = prov;
      const map = localStorage.getItem('finnhubSymbolMap');
      if (map) this.finnhubSymbolMap = JSON.parse(map);
    } catch { }
  }

  async init(){
    await this.initDb();
    const t = await this.getTrades();
    const tr = await this.getTransfers();
    const dv = await this.getDividends();
    const op = await this.getOptions();
    this.trades.set(t);
    this.transfers.set(tr);
    this.dividends.set(dv);
    this.options.set(op);
    this.tradeKeys = new Set(t.map(r => `${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`));
    this.tradeIds = new Set(t.map(r => String(r.TradeID||'')));
    this.transferIds = new Set(tr.map(r => String(r.TransactionID)));
    this.dividendIds = new Set(dv.map(r => String(r.ActionID)));
  }

  // CSV helpers
  parseFiles(files: FileList, cb: (data: any[]) => void){
    const arr = Array.from(files || []);
    if (!arr.length) return;
    Promise.all(arr.map(file => new Promise<any[]>(resolve => {
      Papa.parse(file, { header: true, dynamicTyping: true, quote: true, complete: (res:any)=> resolve(res.data) });
    }))).then(results => cb(results.flat()));
  }

  // Sanitizadores
  parseDateTime(value:any){
    if (!value) return null as Date|null;
    const clean = String(value).replace(';', ' ').trim();
    const [datePart, timePart = ''] = clean.split(' ');
    const [day, month, year] = datePart.split('/').map(Number);
    if (!day || !month || !year) return null as any;
    let hours = 0, minutes = 0, seconds = 0;
    if (timePart) {
      const [h = '0', m = '0', s = '0'] = timePart.split(':');
      hours = parseInt(h, 10) || 0;
      minutes = parseInt(m, 10) || 0;
      seconds = parseInt(s, 10) || 0;
    }
    return new Date(year, month - 1, day, hours, minutes, seconds);
  }

  sanitizeOperations(data:any[]){
    const stocks: TradeRow[] = [];
    const cash: TransferRow[] = [];
    const options: OptionRow[] = [];
    data.forEach(row => {
      const assetClass = (row.AssetClass || row.Asset || '').toString().trim().toUpperCase();
      const symbol = row.Symbol || row.Ticker || '';
      const isin = row.ISIN || row.Isin || '';
      const execId = row.IBExecID || row.ExecID || row.ExecutionID || row.ExecutionId || '';
      const qty = parseFloat(row.Quantity ?? row.Shares ?? 0) || 0;
      const price = parseFloat(row.TradePrice ?? row.Price ?? row.PurchasePrice ?? 0) || 0;
      const commission = parseFloat(row.IBComission ?? row.IBCommission ?? row.Commission ?? 0) || 0;
      const commissionCurrency = (row.IBCommissionCurrency || row.CommissionCurrency || '').toString().toUpperCase();
      const currency = (row.CurrencyPrimary || row.Currency || '').toString().toUpperCase();
      const dt = this.parseDateTime(row.DateTime || row['Date/Time'] || row.Date || row.Fecha);
      if (!dt) return;
      if (assetClass === 'STK' && symbol && isin) {
        stocks.push({ TradeID: execId || undefined, Ticker: symbol, Quantity: qty, PurchasePrice: price, DateTime: dt, Commission: commission, CommissionCurrency: commissionCurrency, CurrencyPrimary: currency, ISIN: isin, AssetClass: assetClass });
        return;
      }
      if (assetClass === 'CASH') {
        const side = String(row['Buy/Sell'] || row.Side || row.BS || '').trim().toUpperCase();
        if (symbol && String(symbol).includes('.')) {
          const fx = this.buildFxTransfers({ symbol, side, qty, price, commission, commissionCurrency, dt, execId });
          cash.push(...fx);
          return;
        }
        const c = this.deriveCurrency(row, symbol);
        const commissionAdj = commissionCurrency && commissionCurrency !== c ? 0 : commission;
        const amount = (qty * price) + commissionAdj;
        const txId = execId ? `CASH:${execId}` : `CASH:${symbol}:${dt.getTime()}:${amount.toFixed(4)}`;
        cash.push({ TransactionID: txId, DateTime: dt, Amount: amount, CurrencyPrimary: c });
        return;
      }

      if (assetClass === 'OPT') {
        // Prima de opciones: importe = qty (contratos) * tradePrice * multiplier + comisión (si misma divisa)
        const side = String(row['Buy/Sell'] || row.Side || row.BS || '').trim().toUpperCase();
        const parsed = this.parseOccSymbol(String(symbol||''));
        const multiplier = parsed.calcMultiplier || 100;
        const gross = (Math.abs(qty) * price * multiplier);
        let flow = 0;
        if (side === 'SELL') flow = +gross; // al vender opciones, se cobra prima
        else if (side === 'BUY') flow = -gross; // al comprar opciones, se paga prima
        else {
          // fallback por signo de qty: qty < 0 => vendes (cobras), qty > 0 => compras (pagas)
          flow = (qty < 0) ? +gross : -gross;
        }
        const c = currency || 'USD';
        const commissionAdj = commissionCurrency && commissionCurrency !== c ? 0 : commission;
        const amount = flow + commissionAdj;
        const optId = row.IVExecID || row.IBExecID || row.ExecID || row.ExecutionID || row.ExecutionId || '';
        const txId = optId ? `OPT:${optId}` : `OPT:${symbol}:${dt.getTime()}:${Math.abs(qty)}:${price}`;
        cash.push({ TransactionID: txId, DateTime: dt, Amount: amount, CurrencyPrimary: c });
        const underlying = (row.Underlying || parsed.underlying || this.extractUnderlyingFromSymbol(symbol) || '').toString().toUpperCase();
        const contracts = Math.abs(qty);
        const notional = (parsed.strike || 0) * (parsed.calcMultiplier || multiplier) * contracts;
        options.push({
          OptionID: txId,
          underlying,
          symbol: String(symbol),
          side: (side === 'BUY' || side === 'SELL') ? side : 'UNKNOWN',
          contracts,
          tradePrice: price,
          multiplier,
          premiumGross: gross,
          commission: commission || 0,
          commissionCurrency: commissionCurrency || undefined,
          currencyPrimary: c,
          DateTime: dt,
          execId: optId || undefined,
          expiry: parsed.expiry || undefined,
          optType: parsed.optType as any,
          strike: parsed.strike,
          calcMultiplier: parsed.calcMultiplier,
          notional
        });
        return;
      }
    });
    return { stocks, cash, options };
  }

  deriveCurrency(row:any, symbol:string){
    const c1 = row.CurrencyPrimary || row.Currency || '';
    if (c1) return String(c1).toUpperCase();
    const s = String(symbol || '').toUpperCase();
    if (s.includes('.')) return s.split('.')[1];
    return s || 'USD';
  }

  buildFxTransfers({ symbol, side, qty, price, commission, commissionCurrency, dt, execId }:{ symbol:string; side:string; qty:number; price:number; commission:number; commissionCurrency:string; dt:Date; execId?:string; }): TransferRow[] {
    const [base, quote] = String(symbol).toUpperCase().split('.');
    const absQty = Math.abs(Number(qty) || 0);
    const rate = Number(price) || 0;
    let baseAmount = absQty;
    let quoteAmount = absQty * rate;
    let baseFlow = 0;
    let quoteFlow = 0;
    if (side === 'SELL') { baseFlow = -baseAmount; quoteFlow = +quoteAmount; }
    else if (side === 'BUY') { baseFlow = +baseAmount; quoteFlow = -quoteAmount; }
    else { if ((Number(qty) || 0) < 0) { baseFlow = -baseAmount; quoteFlow = +quoteAmount; } else { baseFlow = +baseAmount; quoteFlow = -quoteAmount; } }
    const comm = Number(commission) || 0;
    const commCur = String(commissionCurrency || '').toUpperCase();
    if (comm && commCur) { if (commCur === base) baseFlow += comm; else if (commCur === quote) quoteFlow += comm; }
    const idBase = execId ? `FX:${execId}:${base}` : `FX:${symbol}:${dt.getTime()}:${absQty}:${rate}:${side}:${base}`;
    const idQuote = execId ? `FX:${execId}:${quote}` : `FX:${symbol}:${dt.getTime()}:${absQty}:${rate}:${side}:${quote}`;
    return [
      { TransactionID: idBase, DateTime: dt, Amount: baseFlow, CurrencyPrimary: base },
      { TransactionID: idQuote, DateTime: dt, Amount: quoteFlow, CurrencyPrimary: quote }
    ];
  }

  sanitizeTransfers(data:any[]):TransferRow[]{
    return data.map(row => ({
      TransactionID: row.TransactionID || row.TransactionId || row.ID || row.Id,
      CurrencyPrimary: row.CurrencyPrimary,
      DateTime: this.parseDateTime(row['Date/Time'] || row.DateTime || row.Date)!,
      Amount: parseFloat(row.Amount)
    })).filter(r => r.TransactionID && r.CurrencyPrimary && r.DateTime && !isNaN(r.Amount));
  }

  sanitizeDividends(data:any[]):DividendRow[]{
    return data
      .filter(row => String(row.Code || row.ActionCode || '').trim() === 'Po')
      .map(row => {
        const gross = parseFloat(row.GrossAmount);
        const tax = parseFloat(row.Tax) || 0;
        return {
          ActionID: row.ActionID || row.ActionId || row.ID || row.Id,
          Ticker: row.Ticker || row.Symbol || row.Underlying || row.Asset,
          CurrencyPrimary: row.CurrencyPrimary || row.Currency,
          DateTime: this.parseDateTime(row['Date/Time'] || row.Date || row.PaymentDate)!,
          GrossAmount: isNaN(gross) ? 0 : gross,
          Tax: tax,
          IssuerCountryCode: row.IssuerCountryCode || row.Country || '',
          Amount: (isNaN(gross) ? 0 : gross) + tax
        } as any;
      })
      .filter((r:any) => r.ActionID && r.CurrencyPrimary && r.DateTime && !isNaN(r.GrossAmount));
  }

  // Importación desde inputs
  async importTradesAndCash(data:any[]){
    const { stocks, cash, options } = this.sanitizeOperations(data);
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    const stockRows = stocks.filter(r => {
      const id = r.TradeID;
      if (id) { if (seenIds.has(id) || this.tradeIds.has(id)) return false; seenIds.add(id); return true; }
      const key = `${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`;
      if (seenKeys.has(key) || this.tradeKeys.has(key)) return false; seenKeys.add(key); return true;
    });
    const seenCash = new Set<string>();
    const cashRows = cash.filter(r => { const key = String(r.TransactionID); if (!key) return false; if (seenCash.has(key) || this.transferIds.has(key)) return false; seenCash.add(key); return true; });
    const dupStocks = stocks.length - stockRows.length;
    const dupCash = cash.length - cashRows.length;
    if (stockRows.length) { await this.addTrades(stockRows); this.trades.set([...this.trades(), ...stockRows]); stockRows.forEach(r => { if (r.TradeID) this.tradeIds.add(r.TradeID); this.tradeKeys.add(`${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`); }); }
    // Derivar flujos de STK
    const stockCashRows = this.stockTradesToCashRows(stockRows).filter(r => !this.transferIds.has(String(r.TransactionID)));
    const newTransfers = [...cashRows, ...stockCashRows];
    if (newTransfers.length) { await this.addTransfers(newTransfers); this.transfers.set([...this.transfers(), ...newTransfers]); newTransfers.forEach(r => this.transferIds.add(String(r.TransactionID))); }
    if (options.length) {
      const existing = new Set(this.options().map(o => o.OptionID));
      const toAdd = options.filter(o => !existing.has(o.OptionID));
      if (toAdd.length) { await this.addOptions(toAdd); this.options.set([...this.options(), ...toAdd]); }
    }
    const msg = `STK: ${stockRows.length} (ign: ${dupStocks}) | CASH/FX: ${cashRows.length} (ign: ${dupCash}) | CASH de STK: ${stockCashRows.length}.`;
    this.toast.success(msg);
  }

  async importTransfers(data:any[]){
    const input = this.sanitizeTransfers(data);
    const seen = new Set<string>();
    const rows = input.filter(r => { const key = String(r.TransactionID); if (!key) return false; if (seen.has(key) || this.transferIds.has(key)) return false; seen.add(key); return true; });
    const dupCount = input.length - rows.length;
    if (rows.length) { await this.addTransfers(rows); this.transfers.set([...this.transfers(), ...rows]); rows.forEach(r => this.transferIds.add(String(r.TransactionID))); }
    this.toast.success(`Transferencias importadas: ${rows.length} (ign: ${dupCount}).`);
  }

  async importDividends(data:any[]){
    const input = this.sanitizeDividends(data);
    const seen = new Set<string>();
    const rows = input.filter(r => { const key = String(r.ActionID); if (!key) return false; if (seen.has(key) || this.dividendIds.has(key)) return false; seen.add(key); return true; });
    const dupCount = input.length - rows.length;
    if (rows.length) { await this.addDividends(rows); this.dividends.set([...this.dividends(), ...rows]); rows.forEach(r => this.dividendIds.add(String(r.ActionID))); }
    this.toast.success(`Dividendos importados: ${rows.length} (ign: ${dupCount}).`);
  }

  stockTradesToCashRows(stockRows:TradeRow[]):TransferRow[]{
    return stockRows.filter(r => r && r.DateTime && r.CurrencyPrimary && typeof r.Quantity === 'number' && typeof r.PurchasePrice === 'number')
      .map(r => {
        const qty = Number(r.Quantity) || 0;
        const price = Number(r.PurchasePrice) || 0;
        const comm = (r.CommissionCurrency && r.CommissionCurrency !== r.CurrencyPrimary) ? 0 : (Number(r.Commission) || 0);
        const amount = qty > 0 ? -(qty * price) + comm : (-qty * price) + comm;
        const id = r.TradeID ? `STK:${r.TradeID}` : `STK:${r.Ticker}:${(r.DateTime as Date).getTime()}:${qty}:${price}`;
        return { TransactionID: id, DateTime: r.DateTime as Date, Amount: amount, CurrencyPrimary: r.CurrencyPrimary as string };
      });
  }

  // Agregadores básicos
  aggregateTradesFifoByTicker(trades:TradeRow[]){
    const groups:Record<string, TradeRow[]> = {};
    trades.forEach(tr => { if (!tr.Ticker) return; if (!groups[tr.Ticker]) groups[tr.Ticker] = []; groups[tr.Ticker].push(tr); });
    const result: any = {};
    Object.keys(groups).forEach(ticker => {
      const rows = groups[ticker].slice().sort((a,b) => (a.DateTime?.getTime?.()||0) - (b.DateTime?.getTime?.()||0));
      const lots: {qty:number;cps:number}[] = [];
      let realized = 0;
      rows.forEach(r => {
        const q = Number(r.Quantity) || 0;
        const p = Number(r.PurchasePrice) || 0;
        const comm = Math.abs(Number(r.Commission)||0);
        if (q > 0){ const totalCost = q * p + comm; const cps = totalCost / q; lots.push({qty:q, cps}); }
        else if (q < 0){ let sellQty = -q; let sellValuePerShare = p; while (sellQty>0 && lots.length>0){ const lot = lots[0]; const take = Math.min(lot.qty, sellQty); realized += take * (sellValuePerShare - lot.cps); lot.qty -= take; sellQty -= take; if (lot.qty <= 1e-7) lots.shift(); } realized -= comm; }
      });
      const currentQty = lots.reduce((acc,l)=>acc+l.qty,0);
      const totalCostLeft = lots.reduce((acc,l)=>acc+l.qty*l.cps,0);
      const avgCost = currentQty > 0 ? totalCostLeft / currentQty : 0;
      result[ticker] = { currentQty, avgCost, realizedProfit: realized };
    });
    return result;
  }

  computeDividendStats(divs:DividendRow[]){
    const map:Record<string, {total:number; last12m:number}> = {};
    const now = Date.now(); const lastYear = now - 365*24*60*60*1000;
    divs.forEach(d => { const t = d.Ticker as string; if (!t) return; if (!map[t]) map[t] = { total: 0, last12m: 0 }; map[t].total += Number(d.Amount)||0; const time = d.DateTime instanceof Date ? d.DateTime.getTime() : 0; if (time >= lastYear) map[t].last12m += Number(d.Amount)||0; });
    return map;
  }

  computeTradeCashFlowByTicker(trs:TradeRow[]){
    const map:Record<string, number> = {};
    trs.forEach(r => { if (!r.Ticker) return; const qty = Number(r.Quantity)||0; const price = Number(r.PurchasePrice)||0; const comm = Number(r.Commission)||0; const amount = qty>0 ? -(qty*price)+comm : (-qty*price)+comm; map[r.Ticker] = (map[r.Ticker]||0)+amount; });
    return map;
  }

  computeOptionPremiumByUnderlying(opts:OptionRow[]){
    const map: Record<string, number> = {};
    opts.forEach(o => {
      const net = (o.side === 'SELL' ? +o.premiumGross : -o.premiumGross) + (o.commission || 0);
      map[o.underlying] = (map[o.underlying] || 0) + net;
    });
    return map;
  }

  computeOptionStatsByUnderlying(opts: OptionRow[]){
    const map: Record<string, { putsContracts:number; callsContracts:number; putsNotional:number; callsNotional:number; netNotional:number }>
      = {} as any;
    opts.forEach(o => {
      const u = o.underlying || '';
      if (!map[u]) map[u] = { putsContracts:0, callsContracts:0, putsNotional:0, callsNotional:0, netNotional:0 };
      const contracts = Math.abs(Number(o.contracts)||0);
      const strike = Number((o as any).strike) || 0;
      const mult = Number((o as any).calcMultiplier) || Number((o as any).multiplier) || 100;
      const notional = Number((o as any).notional) || (strike * mult * contracts) || 0;
      if ((o as any).optType === 'P') { map[u].putsContracts += contracts; map[u].putsNotional += notional; map[u].netNotional += notional; }
      else if ((o as any).optType === 'C') { map[u].callsContracts += contracts; map[u].callsNotional += notional; map[u].netNotional += notional; }
    });
    return map;
  }

  // Precios con actualización incremental según proveedor
  async fetchPricesBatch(tickers: string[]) {
    const out: Record<string, number> = {} as any;
    for (const t of tickers) {
      out[t] = await this.fetchPrice(t);
      if (this.priceProvider === 'finnhub') { await this.delay(1100); } // 60/min gratis
    }
    return out;
  }
  async fetchPrice(ticker:string){
    try {
      // Asegurar series actualizadas en DB y devolver el último cierre conocido
      if (this.priceProvider === 'finnhub') await this.ensurePricesUpToDateFinnhub(ticker);
      else await this.ensurePricesUpToDateAlpha(ticker);
      const last = this.getLatestCloseFromDb(ticker);
      return last ?? 0;
    } catch (e) {
      if (!this.priceErrorShown.has(ticker)) {
        this.toast.error(`No se pudo obtener el precio para ${ticker}.`);
        this.priceErrorShown.add(ticker);
      }
      return 0;
    }
  }

  // Configuración de proveedores y API keys (se guardan en localStorage)
  setAlphaVantageKey(key: string) { this.alphaApiKey = key || null; try { if (key) localStorage.setItem('alphaVantageKey', key); else localStorage.removeItem('alphaVantageKey'); } catch { } }
  getAlphaVantageKey() { return this.alphaApiKey; }
  setFinnhubKey(key: string) { this.finnhubApiKey = key || null; try { if (key) localStorage.setItem('finnhubKey', key); else localStorage.removeItem('finnhubKey'); } catch { } }
  getFinnhubKey() { return this.finnhubApiKey; }
  setPriceProvider(provider: 'alpha' | 'finnhub') { this.priceProvider = provider; try { localStorage.setItem('priceProvider', provider); } catch { } }
  getPriceProvider() { return this.priceProvider; }
  private saveFinnhubMap() { try { localStorage.setItem('finnhubSymbolMap', JSON.stringify(this.finnhubSymbolMap)); } catch { } }
  async updateAllPrices() {
    // Construir universo de tickers desde trades y opciones
    const trades = this.trades();
    const opts = this.options();
    const set = new Set<string>();
    trades.forEach(t => { if (t.Ticker) set.add(String(t.Ticker).toUpperCase()); });
    opts.forEach(o => { if (o.underlying) set.add(String(o.underlying).toUpperCase()); });
    const tickers = Array.from(set.values());
    let addedTotal = 0;
    for (const t of tickers) {
      try {
        const added = this.priceProvider === 'finnhub'
          ? await this.ensurePricesUpToDateFinnhub(t)
          : await this.ensurePricesUpToDateAlpha(t);
        addedTotal += (added || 0);
      } catch (err: any) {
        this.toast.error(`${t}: error al actualizar precios.`);
      }
      if (this.priceProvider === 'finnhub') { await this.delay(1100); }
    }
    this.toast.success(`Precios actualizados: ${addedTotal} registros nuevos (${tickers.length} tickers).`);
    return { updated: addedTotal, tickers };
  }

  async updatePricesForTicker(ticker: string) {
    if (!ticker) return { updated: 0 };
    try {
      const added = this.priceProvider === 'finnhub'
        ? await this.ensurePricesUpToDateFinnhub(String(ticker).toUpperCase())
        : await this.ensurePricesUpToDateAlpha(String(ticker).toUpperCase());
      return { updated: added || 0 };
    } catch (e) {
      this.toast.error(`${ticker}: error al actualizar precios.`);
      return { updated: 0 };
    }
  }

  // Persistencia con SQL.js
  private SQL:any; private _db:any;
  private async initDb(){ if (this._db) return this._db; if (!this.SQL) this.SQL = await initSqlJs({ locateFile: (f:string)=>`https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${f}` }); const saved = localStorage.getItem('portfolioDB'); this._db = saved ? new this.SQL.Database(Uint8Array.from(atob(saved), (c:any)=>c.charCodeAt(0))) : new this.SQL.Database(); this.ensureSchema(); if (!saved) this.saveDb(); return this._db; }
  private saveDb(){
    if (!this._db) return;
    const data = this._db.export();
    const bytes = new Uint8Array(data);
    const CHUNK = 0x8000; // trocear para evitar desbordar la pila
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const sub = bytes.subarray(i, i + CHUNK) as any;
      binary += String.fromCharCode.apply(null, sub);
    }
    const b64 = btoa(binary);
    localStorage.setItem('portfolioDB', b64);
  }
  private ensureSchema(){
    try {
      this._db.run(`CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, ticker TEXT, quantity REAL, purchase REAL, date INTEGER, commission REAL);`);
      this._db.run(`CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, date INTEGER, amount REAL, currency TEXT);`);
      this._db.run(`CREATE TABLE IF NOT EXISTS dividends (id TEXT PRIMARY KEY, date INTEGER, amount REAL, currency TEXT, ticker TEXT, tax REAL, country TEXT);`);
      this._db.run(`CREATE TABLE IF NOT EXISTS options (id TEXT PRIMARY KEY, date INTEGER, underlying TEXT, symbol TEXT, side TEXT, contracts INTEGER, tradePrice REAL, multiplier INTEGER, premiumGross REAL, commission REAL, commCurrency TEXT, currency TEXT);`);
      this._db.run(`CREATE TABLE IF NOT EXISTS prices (ticker TEXT, date INTEGER, close REAL, PRIMARY KEY (ticker, date));`);
      // Migración: añadir columnas si faltan
      try {
        const info = this._db.exec('PRAGMA table_info(options)');
        const cols = info.length ? info[0].values.map((v:any)=> v[1]) : [];
        if (cols.indexOf('execId') === -1) {
          this._db.run('ALTER TABLE options ADD COLUMN execId TEXT');
        }
        if (cols.indexOf('expiry') === -1) this._db.run('ALTER TABLE options ADD COLUMN expiry INTEGER');
        if (cols.indexOf('optType') === -1) this._db.run('ALTER TABLE options ADD COLUMN optType TEXT');
        if (cols.indexOf('strike') === -1) this._db.run('ALTER TABLE options ADD COLUMN strike REAL');
        if (cols.indexOf('calcMultiplier') === -1) this._db.run('ALTER TABLE options ADD COLUMN calcMultiplier INTEGER');
        if (cols.indexOf('notional') === -1) this._db.run('ALTER TABLE options ADD COLUMN notional REAL');
      } catch {}
    } catch {}
  }
  async addTrades(rows:TradeRow[]){ await this.initDb(); const stmt = this._db.prepare('INSERT OR IGNORE INTO trades (id, ticker, quantity, purchase, date, commission) VALUES (?,?,?,?,?,?)'); this._db.run('BEGIN'); rows.forEach(r => stmt.run([ String(r.TradeID || `legacy:${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`), r.Ticker, r.Quantity, r.PurchasePrice, r.DateTime instanceof Date ? r.DateTime.getTime() : null, typeof r.Commission === 'number' ? r.Commission : null ])); this._db.run('COMMIT'); stmt.free(); this.saveDb(); }
  async addTransfers(rows:TransferRow[]){ await this.initDb(); const stmt = this._db.prepare('INSERT OR IGNORE INTO transfers VALUES (?,?,?,?)'); this._db.run('BEGIN'); rows.forEach(r => stmt.run([ String(r.TransactionID), r.DateTime.getTime(), r.Amount, r.CurrencyPrimary ])); this._db.run('COMMIT'); stmt.free(); this.saveDb(); }
  async addDividends(rows:DividendRow[]){ await this.initDb(); const stmt = this._db.prepare('INSERT OR IGNORE INTO dividends VALUES (?,?,?,?,?,?,?)'); this._db.run('BEGIN'); rows.forEach(r => stmt.run([ String(r.ActionID), r.DateTime.getTime(), r.Amount, r.CurrencyPrimary, r.Ticker || '', r.Tax, r.IssuerCountryCode ])); this._db.run('COMMIT'); stmt.free(); this.saveDb(); }
  async addOptions(rows:any[]){
    await this.initDb(); if (!rows.length) return;
    let cols:string[] = [];
    try {
      const info = this._db.exec('PRAGMA table_info(options)');
      cols = info.length ? info[0].values.map((v:any)=> v[1]) : [];
    } catch {}
    const present = ['id','date','underlying','symbol','side','contracts','tradePrice','multiplier','premiumGross','commission','commCurrency','currency','execId','expiry','optType','strike','calcMultiplier','notional'].filter(c => cols.indexOf(c)!==-1);
    const sql = `INSERT OR IGNORE INTO options (${present.join(',')}) VALUES (${present.map(()=>'?').join(',')})`;
    const stmt = this._db.prepare(sql);
    this._db.run('BEGIN');
    rows.forEach((r:any) => {
      const vals:Record<string, any> = {
        id:String(r.OptionID), date:r.DateTime.getTime(), underlying:r.underlying, symbol:r.symbol, side:r.side,
        contracts:r.contracts, tradePrice:r.tradePrice, multiplier:r.multiplier, premiumGross:r.premiumGross,
        commission:r.commission, commCurrency:r.commissionCurrency||null, currency:r.currencyPrimary,
        execId:r.execId||null, expiry:r.expiry? r.expiry.getTime(): null, optType:r.optType||null, strike:r.strike||null,
        calcMultiplier:r.calcMultiplier||null, notional:r.notional||null
      };
      const params = present.map(c => vals[c]);
      stmt.run(params);
    });
    this._db.run('COMMIT'); stmt.free(); this.saveDb();
  }
  async getOptions():Promise<any[]>{
    await this.initDb();
    let cols:string[] = [];
    try {
      const info = this._db.exec('PRAGMA table_info(options)');
      cols = info.length ? info[0].values.map((v:any)=> v[1]) : [];
    } catch {}
    const selectCols = ['id','date','underlying','symbol','side','contracts','tradePrice','multiplier','premiumGross','commission','commCurrency','currency'];
    if (cols.indexOf('execId')!==-1) selectCols.push('execId');
    if (cols.indexOf('expiry')!==-1) selectCols.push('expiry');
    if (cols.indexOf('optType')!==-1) selectCols.push('optType');
    if (cols.indexOf('strike')!==-1) selectCols.push('strike');
    if (cols.indexOf('calcMultiplier')!==-1) selectCols.push('calcMultiplier');
    if (cols.indexOf('notional')!==-1) selectCols.push('notional');
    const sql = `SELECT ${selectCols.join(', ')} FROM options`;
    const res = this._db.exec(sql);
    if (!res.length) return [];
    return res[0].values.map((row:any[]) => {
      const out:any = { OptionID: row[0], DateTime: new Date(row[1]), underlying: row[2], symbol: row[3], side: row[4], contracts: row[5], tradePrice: row[6], multiplier: row[7], premiumGross: row[8], commission: row[9], commissionCurrency: row[10], currencyPrimary: row[11] };
      let i = 12;
      if (cols.indexOf('execId')!==-1) out.execId = row[i++];
      if (cols.indexOf('expiry')!==-1) { const v = row[i++]; out.expiry = v ? new Date(v) : undefined; }
      if (cols.indexOf('optType')!==-1) out.optType = row[i++];
      if (cols.indexOf('strike')!==-1) out.strike = row[i++];
      if (cols.indexOf('calcMultiplier')!==-1) out.calcMultiplier = row[i++];
      if (cols.indexOf('notional')!==-1) out.notional = row[i++];
      return out;
    });
  }
  async getTrades():Promise<TradeRow[]>{ await this.initDb(); const res = this._db.exec('SELECT id, ticker, quantity, purchase, date, commission FROM trades'); if (!res.length) return []; return res[0].values.map((row:any[]) => ({ TradeID: row[0], Ticker: row[1], Quantity: row[2], PurchasePrice: row[3], DateTime: row[4] ? new Date(row[4]) : null, Commission: row[5] ?? null })); }
  async getTransfers():Promise<TransferRow[]>{ await this.initDb(); const res = this._db.exec('SELECT id, date, amount, currency FROM transfers'); if (!res.length) return []; return res[0].values.map((row:any[]) => ({ TransactionID: row[0], DateTime: new Date(row[1]), Amount: row[2], CurrencyPrimary: row[3] })); }
  async getDividends():Promise<DividendRow[]>{ await this.initDb(); const res = this._db.exec('SELECT id, date, amount, currency, ticker, tax, country FROM dividends'); if (!res.length) return []; return res[0].values.map((row:any[]) => ({ ActionID: row[0], DateTime: new Date(row[1]), Amount: row[2], CurrencyPrimary: row[3], Ticker: row[4], Tax: row[5], IssuerCountryCode: row[6] })); }

  private extractUnderlyingFromSymbol(symbol:string){
    const s = String(symbol || '').toUpperCase();
    const m = s.match(/^[A-Z]+/);
    return m ? m[0] : '';
  }

  private parseOccSymbol(symbol:string){
    const s = String(symbol || '').toUpperCase().trim();
    // Soportar distintas variantes sin '@' y con/ sin espacio entre raíz y resto
    // Patrones posibles:
    //  - ABC 240119C00190000
    //  - ABC240119C00190000
    //  - ABC@240119C00190000
    const patterns = [
      /^([A-Z0-9.-]+)\s+(\d{6})([CP])(\d{8})$/,   // con espacio
      /^([A-Z0-9.-]+)@(\d{6})([CP])(\d{8})$/,      // con '@'
      /^([A-Z0-9.-]+?)(\d{6})([CP])(\d{8})$/       // sin separador
    ];
    let m: RegExpMatchArray | null = null;
    for (const p of patterns) { m = s.match(p); if (m) break; }
    if (!m) return { underlying:'', expiry:undefined, optType:undefined as any, strike:undefined, calcMultiplier:undefined };
    const underlying = m[1];
    const yy = parseInt(m[2].slice(0,2), 10); const mm = parseInt(m[2].slice(2,4), 10); const dd = parseInt(m[2].slice(4,6), 10);
    const year = 2000 + yy; const expiry = new Date(year, mm-1, dd);
    const optType = (m[3] as any);
    const strikeRaw = parseInt(m[4], 10) || 0;
    const strike = strikeRaw / 1000; // OCC: 3 decimales (strike viene multiplicado por 1000)
    const calcMultiplier = 100;      // multiplicador estándar de contratos de equity (prima/notional)
    return { underlying, expiry, optType, strike, calcMultiplier };
  }

  // Reset de datos locales
  async reset(){
    try { localStorage.removeItem('portfolioDB'); } catch {}
    try { if (this._db && typeof this._db.close === 'function') this._db.close(); } catch {}
    this._db = null;
    // Limpiar estado en memoria
    this.trades.set([]);
    this.transfers.set([]);
    this.dividends.set([]);
    this.tradeKeys.clear();
    this.tradeIds.clear();
    this.transferIds.clear();
    this.dividendIds.clear();
    this.priceErrorShown.clear();
    this.toast.success('Datos locales borrados correctamente.');
  }

  // ====== Precios (Alpha Vantage) ======
  private getLatestPriceDateFromDb(ticker: string): number | null {
    try {
      const stmt = this._db.prepare('SELECT MAX(date) as d FROM prices WHERE ticker = ?');
      stmt.bind([ticker]);
      let out: number | null = null;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        const v = (row as any).d;
        out = (typeof v === 'number' && !isNaN(v)) ? v : null;
      }
      stmt.free();
      return out;
    } catch { return null; }
  }
  private getLatestCloseFromDb(ticker: string): number | null {
    try {
      const stmt = this._db.prepare('SELECT close FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 1');
      stmt.bind([ticker]);
      let out: number | null = null;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        const v = (row as any).close;
        out = (typeof v === 'number' && !isNaN(v)) ? v : null;
      }
      stmt.free();
      return out;
    } catch { return null; }
  }
  private addPricesDb(ticker: string, rows: { date: number; close: number }[]) {
    if (!rows.length) return;
    const stmt = this._db.prepare('INSERT OR IGNORE INTO prices (ticker, date, close) VALUES (?,?,?)');
    this._db.run('BEGIN');
    rows.forEach(r => stmt.run([ticker, r.date, r.close]));
    this._db.run('COMMIT');
    stmt.free();
    this.saveDb();
  }
  async getPricesSeries(ticker: string): Promise<{ date: Date, close: number }[]> {
    await this.initDb();
    const stmt = this._db.prepare('SELECT date, close FROM prices WHERE ticker = ? ORDER BY date ASC');
    stmt.bind([ticker]);
    const out: { date: Date, close: number }[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const d = (row as any).date as number;
      const c = (row as any).close as number;
      if (typeof d === 'number' && typeof c === 'number') out.push({ date: new Date(d), close: c });
    }
    stmt.free();
    return out;
  }
  getLatestPriceDate(ticker: string): Date | null {
    const ms = this.getLatestPriceDateFromDb(ticker);
    return ms ? new Date(ms) : null;
  }
  private async ensurePricesUpToDateAlpha(ticker: string) {
    await this.initDb();
    const key = this.alphaApiKey;
    if (!key) { if (!this.priceErrorShown.has('APIKEY')) { this.toast.info('Configura tu API Key de Alpha Vantage para actualizar precios.'); this.priceErrorShown.add('APIKEY'); } return 0; }
    const lastDateMs = this.getLatestPriceDateFromDb(ticker);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (lastDateMs && lastDateMs >= today.getTime()) return 0; // ya está al día
    // Descargar serie compacta (últimos ~100 días) y guardar solo faltantes
    this.toast.info(`Descargando precios de ${ticker} (Alpha Vantage)...`);
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=compact&apikey=${encodeURIComponent(key)}`;
    const resp = await fetch(url);
    const json = await resp.json();
    const series = json['Time Series (Daily)'] || json['Time Series Daily'] || {};
    const rows: { date: number; close: number }[] = Object.keys(series).map(d => {
      const o = series[d];
      const close = parseFloat(o['5. adjusted close'] ?? o['4. close'] ?? '0') || 0;
      const [y, m, dd] = d.split('-').map(n => parseInt(n, 10));
      const ms = new Date(y, (m || 1) - 1, dd || 1).setHours(0, 0, 0, 0);
      return { date: ms, close };
    }).filter(r => r.close > 0)
      .sort((a, b) => a.date - b.date);
    const missing = lastDateMs ? rows.filter(r => r.date > lastDateMs) : rows;
    this.addPricesDb(ticker, missing);
    if (missing.length > 0) this.toast.success(`${ticker}: ${missing.length} registros nuevos (Alpha).`);
    else this.toast.info(`${ticker}: sin cambios (Alpha).`);
    return missing.length;
  }

  private async ensurePricesUpToDateFinnhub(ticker: string) {
    await this.initDb();
    const key = this.finnhubApiKey;
    if (!key) { if (!this.priceErrorShown.has('FINNAPIKEY')) { this.toast.info('Configura tu API Key de Finnhub para actualizar precios.'); this.priceErrorShown.add('FINNAPIKEY'); } return 0; }
    const lastDateMs = this.getLatestPriceDateFromDb(ticker);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // Si ya hay dato de hoy, no llamar a la API
    if (lastDateMs && lastDateMs >= today.getTime()) return 0;
    this.toast.info(`Descargando precios de ${ticker} (Finnhub Quote)...`);
    const sym = await this.resolveFinnhubSymbol(ticker, key);
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if ((resp.status === 403) || (json && typeof json.error === 'string' && json.error.toLowerCase().includes("don't have access"))) {
      this.toast.warning(`${ticker}: Finnhub denegó acceso a este recurso.`);
      return 0;
    }
    // Esperamos campos: c (precio actual), t (epoch seconds)
    const close = Number(json?.c || 0);
    const tsSec = Number(json?.t || 0);
    if (!close || !tsSec) { this.toast.info(`${ticker}: sin datos de Quote en Finnhub.`); return 0; }
    const d = new Date(tsSec * 1000); d.setHours(0,0,0,0);
    const row = { date: d.getTime(), close };
    if (lastDateMs && row.date <= lastDateMs) { this.toast.info(`${ticker}: sin cambios (Finnhub Quote).`); return 0; }
    this.addPricesDb(ticker, [row]);
    this.toast.success(`${ticker}: 1 registro nuevo (Finnhub Quote).`);
    return 1;
  }

  private delay(ms: number) { return new Promise<void>(res => setTimeout(res, ms)); }
  private normalizeTickerForSearch(t: string) { const up = String(t || '').toUpperCase(); return up.includes('.') ? up.split('.')[0] : up; }
  private async resolveFinnhubSymbol(ticker: string, key: string): Promise<string> {
    const t = String(ticker).toUpperCase();
    if (this.finnhubSymbolMap[t]) return this.finnhubSymbolMap[t];
    const q = this.normalizeTickerForSearch(t);
    try {
      const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${encodeURIComponent(key)}`;
      const resp = await fetch(url);
      const json = await resp.json();
      const results = Array.isArray(json?.result) ? json.result : [];
      let best: any = results.find((r: any) => String(r.symbol || '').toUpperCase() === q) || results.find((r: any) => String(r.symbol || '').toUpperCase().startsWith(q)) || results[0];
      const sym = String(best?.symbol || q);
      this.finnhubSymbolMap[t] = sym; this.saveFinnhubMap();
      return sym;
    } catch { return q; }
  }
}
