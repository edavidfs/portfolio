import { Injectable, signal } from '@angular/core';
import { ToastService } from './toast.service';

declare const Chart: any;
declare const Papa: any;

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

interface PricePoint { date: number; close: number }
const PRICE_PREFIX = 'portfolio_prices:';

@Injectable({providedIn: 'root'})
export class DataService {
  trades = signal<TradeRow[]>([]);
  transfers = signal<TransferRow[]>([]);
  dividends = signal<DividendRow[]>([]);
  options = signal<OptionRow[]>([]);
  private apiBase = (() => {
    if (typeof window !== 'undefined') {
      const w = window as any;
      const custom = w?.__PORTFOLIO_API__;
      if (custom && typeof custom === 'string') return custom;
    }
    return 'http://127.0.0.1:8000';
  })();
  private backendNotified = false;

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
    this.trades.set([]);
    this.transfers.set([]);
    this.dividends.set([]);
    this.options.set([]);
    this.tradeKeys.clear();
    this.tradeIds.clear();
    this.transferIds.clear();
    this.dividendIds.clear();
    await this.syncTransfersFromBackend();
    await this.syncTradesFromBackend();
    await this.syncDividendsFromBackend();
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
    // Derivar flujos de STK
    const stockCashRows = this.stockTradesToCashRows(stockRows).filter(r => !this.transferIds.has(String(r.TransactionID)));
    const newTransfers = [...cashRows, ...stockCashRows];
    if (options.length) {
      const existing = new Set(this.options().map(o => o.OptionID));
      const toAdd = options.filter(o => !existing.has(o.OptionID));
      if (toAdd.length) { this.options.set([...this.options(), ...toAdd]); }
    }
    const msg = `STK: ${stockRows.length} (ign: ${dupStocks}) | CASH/FX: ${cashRows.length} (ign: ${dupCash}) | CASH de STK: ${stockCashRows.length}.`;
    this.toast.success(msg);
    if (stockRows.length) {
      await this.importTradesToBackend(stockRows);
      await this.syncTradesFromBackend();
    }
    if (newTransfers.length) {
      await this.importTransfersFromBackendPayload(newTransfers);
    }
  }

  async importTransfersFromBackendPayload(rows:any[]){
    if (!rows.length) return;
    try {
      const payload = this.normalizeRowsForBackend(rows);
      await this.apiPost('/import/transfers', { rows: payload });
      await this.syncTransfersFromBackend();
      this.toast.success(`Transferencias importadas (backend): ${rows.length}.`);
    } catch (error:any) {
      console.error('importTransfersFromBackendPayload', error);
      const msg = typeof error === 'string' ? error : error?.message || 'Error al importar transferencias.';
      this.toast.error(msg);
    }
  }

  async importDividends(data:any[]){
    const input = this.sanitizeDividends(data);
    const seen = new Set<string>();
    const rows = input.filter(r => { const key = String(r.ActionID); if (!key) return false; if (seen.has(key) || this.dividendIds.has(key)) return false; seen.add(key); return true; });
    const dupCount = input.length - rows.length;
    if (!rows.length) {
      this.toast.info(`Sin dividendos nuevos (ign: ${dupCount}).`);
      return;
    }
    try {
      const payload = this.normalizeRowsForBackend(rows);
      await this.apiPost('/import/dividends', { rows: payload });
      await this.syncDividendsFromBackend();
      this.toast.success(`Dividendos importados (backend): ${rows.length} (ign: ${dupCount}).`);
    } catch (error:any) {
      console.error('importDividends', error);
      const msg = typeof error === 'string' ? error : error?.message || 'Error al importar dividendos.';
      this.toast.error(msg);
    }
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
      const last = this.getLatestCloseFromCache(ticker);
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

  // Persistencia ligera de precios en localStorage
  private priceKey(ticker: string){
    const symbol = String(ticker || '').toUpperCase();
    return `${PRICE_PREFIX}${symbol}`;
  }
  private loadPriceSeries(ticker: string): PricePoint[]{
    const key = this.priceKey(ticker);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((row:any) => ({ date: Number(row.date) || 0, close: Number(row.close) || 0 }))
        .filter(row => row.date > 0 && !isNaN(row.close))
        .sort((a,b) => a.date - b.date);
    } catch { return []; }
  }
  private savePriceSeries(ticker: string, rows: PricePoint[]){
    const key = this.priceKey(ticker);
    try { localStorage.setItem(key, JSON.stringify(rows)); } catch {}
  }
  private clearPriceCache(){
    try {
      const keys:string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(PRICE_PREFIX)) keys.push(key);
      }
      keys.forEach(k => localStorage.removeItem(k));
    } catch {}
  }
  private getLatestPriceDateFromCache(ticker: string): number | null {
    const series = this.loadPriceSeries(ticker);
    if (!series.length) return null;
    return series[series.length - 1].date;
  }
  private getLatestCloseFromCache(ticker: string): number | null {
    const series = this.loadPriceSeries(ticker);
    if (!series.length) return null;
    return series[series.length - 1].close;
  }
  private addPricesToCache(ticker: string, rows: PricePoint[]){
    if (!rows.length) return;
    const current = this.loadPriceSeries(ticker);
    const byDate = new Map<number, number>();
    current.forEach(item => byDate.set(item.date, item.close));
    rows.forEach(item => {
      if (!item.date || isNaN(item.close)) return;
      byDate.set(item.date, item.close);
    });
    const merged = Array.from(byDate.entries())
      .map(([date, close]) => ({ date, close }))
      .sort((a,b) => a.date - b.date);
    this.savePriceSeries(ticker, merged);
  }
  async getPricesSeries(ticker: string): Promise<{ date: Date, close: number }[]> {
    const rows = this.loadPriceSeries(ticker);
    return rows.map(row => ({ date: new Date(row.date), close: row.close }));
  }
  getLatestPriceDate(ticker: string): Date | null {
    const ms = this.getLatestPriceDateFromCache(ticker);
    return ms ? new Date(ms) : null;
  }

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
  async resetBackendDb(){
    try {
      console.log("Reset Backend DB")
      await this.apiPost('/reset');
      this.trades.set([]);
      this.transfers.set([]);
      this.dividends.set([]);
      this.options.set([]);
      this.tradeKeys.clear();
      this.tradeIds.clear();
      this.transferIds.clear();
      this.dividendIds.clear();
      this.priceErrorShown.clear();
      this.clearPriceCache();
      await this.syncTransfersFromBackend();
      await this.syncTradesFromBackend();
      await this.syncDividendsFromBackend();
      this.toast.success('Base de datos reiniciada correctamente.');
    } catch (error:any) {
      console.error('reset backend', error);
      const msg = typeof error === 'string' ? error : error?.message || 'No se pudo reiniciar el backend.';
      this.toast.error(msg);
    }
  }

  // ====== Precios (Alpha Vantage / Finnhub)
  private async ensurePricesUpToDateAlpha(ticker: string) {
    const key = this.alphaApiKey;
    if (!key) { if (!this.priceErrorShown.has('APIKEY')) { this.toast.info('Configura tu API Key de Alpha Vantage para actualizar precios.'); this.priceErrorShown.add('APIKEY'); } return 0; }
    const lastDateMs = this.getLatestPriceDateFromCache(ticker);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (lastDateMs && lastDateMs >= today.getTime()) return 0; // ya está al día
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
    this.addPricesToCache(ticker, missing);
    if (missing.length > 0) this.toast.success(`${ticker}: ${missing.length} registros nuevos (Alpha).`);
    else this.toast.info(`${ticker}: sin cambios (Alpha).`);
    return missing.length;
  }

  private async ensurePricesUpToDateFinnhub(ticker: string) {
    const key = this.finnhubApiKey;
    if (!key) { if (!this.priceErrorShown.has('FINNAPIKEY')) { this.toast.info('Configura tu API Key de Finnhub para actualizar precios.'); this.priceErrorShown.add('FINNAPIKEY'); } return 0; }
    const lastDateMs = this.getLatestPriceDateFromCache(ticker);
    const today = new Date(); today.setHours(0, 0, 0, 0);
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
    const close = Number(json?.c || 0);
    const tsSec = Number(json?.t || 0);
    if (!close || !tsSec) { this.toast.info(`${ticker}: sin datos de Quote en Finnhub.`); return 0; }
    const d = new Date(tsSec * 1000); d.setHours(0,0,0,0);
    const row = { date: d.getTime(), close };
    if (lastDateMs && row.date <= lastDateMs) { this.toast.info(`${ticker}: sin cambios (Finnhub Quote).`); return 0; }
    this.addPricesToCache(ticker, [row]);
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
  private async syncTransfersFromBackend(){
    try {
      const remote = await this.apiGet('/transfers');
      if (!this.backendNotified) {
        this.toast.success(`Backend disponible (${this.apiBase}).`);
        this.backendNotified = true;
      }
      if (!Array.isArray(remote) || !remote.length) return;
      const mapped = remote.map(item => ({
        TransactionID: String(item.transaction_id || item.transactionId || ''),
        CurrencyPrimary: String(item.currency || '').toUpperCase(),
        DateTime: item.datetime ? new Date(item.datetime) : new Date(),
        Amount: Number(item.amount) || 0
      })).filter(r => r.TransactionID && r.CurrencyPrimary);
      if (!mapped.length) return;
      this.transfers.set(mapped);
      this.transferIds = new Set(mapped.map(r => String(r.TransactionID)));
      this.toast.info(`Transferencias sincronizadas desde el backend (${mapped.length}).`);
    } catch (error) {
      console.error('syncTransfersFromBackend', error);
      this.toast.warning('No se pudo sincronizar las transferencias del backend.');
    }
  }
  private async syncTradesFromBackend(){
    try {
      const remote = await this.apiGet('/trades');
      if (!Array.isArray(remote)) return;
      const mapped = remote.map(item => ({
        TradeID: item.trade_id,
        Ticker: item.ticker || '',
        Quantity: Number(item.quantity) || 0,
        PurchasePrice: Number(item.purchase) || 0,
        DateTime: item.datetime ? new Date(item.datetime) : null,
        Commission: typeof item.commission === 'number' ? item.commission : null,
        CommissionCurrency: item.commission_currency || undefined,
        CurrencyPrimary: item.currency || undefined,
        ISIN: item.isin || undefined,
        AssetClass: item.asset_class || undefined
      }));
      this.trades.set(mapped);
      this.tradeIds = new Set(mapped.map(r => String(r.TradeID||'')));
      this.tradeKeys = new Set(mapped.map(r => `${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`));
    } catch (error) {
      console.error('syncTradesFromBackend', error);
      this.toast.warning('No se pudo sincronizar las operaciones del backend.');
    }
  }

  private async syncDividendsFromBackend(){
    try {
      const remote = await this.apiGet('/dividends');
      if (!Array.isArray(remote)) return;
      const mapped = remote.map(item => ({
        ActionID: item.action_id,
        Ticker: item.ticker || '',
        CurrencyPrimary: (item.currency || '').toString().toUpperCase(),
        DateTime: item.datetime ? new Date(item.datetime) : null,
        Amount: Number(item.amount) || 0,
        Tax: typeof item.tax === 'number' ? item.tax : 0,
        IssuerCountryCode: item.issuer_country || '',
        GrossAmount: typeof item.gross === 'number' ? item.gross : undefined
      } as DividendRow));
      this.dividends.set(mapped);
      this.dividendIds = new Set(mapped.map(r => String(r.ActionID)));
    } catch (error) {
      console.error('syncDividendsFromBackend', error);
      this.toast.warning('No se pudo sincronizar los dividendos del backend.');
    }
  }

  private async importTradesToBackend(rows:TradeRow[]){
    if (!rows.length) return;
    try {
      const payload = rows.map(r => ({
        ...r,
        DateTime: r.DateTime instanceof Date ? r.DateTime.toISOString() : (r.DateTime || null)
      }));
      await this.apiPost('/import/trades', { rows: payload });
    } catch (error) {
      console.error('importTradesToBackend', error);
      this.toast.warning('No se pudo guardar las operaciones en el backend.');
    }
  }

  private async apiGet(path: string){
    const resp = await fetch(`${this.apiBase}${path}`);
    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error(detail || `Error al solicitar ${path}`);
    }
    return resp.json();
  }

  private async apiPost(path: string, body?:any){
    const resp = await fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error(detail || `Error al enviar a ${path}`);
    }
    return resp.json();
  }

  private normalizeRowsForBackend(rows:any[]){
    let mutated = false;
    const converted = rows.map(row => {
      if (row && row.DateTime instanceof Date) {
        mutated = true;
        return { ...row, DateTime: row.DateTime.toISOString() };
      }
      return row;
    });
    return mutated ? converted : rows;
  }
}
