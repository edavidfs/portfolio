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

@Injectable({providedIn: 'root'})
export class DataService {
  trades = signal<TradeRow[]>([]);
  transfers = signal<TransferRow[]>([]);
  dividends = signal<DividendRow[]>([]);
  options = signal<OptionRow[]>([]);
  baseCurrency = signal<string>('USD');
  syncingFx = signal<boolean>(false);
  syncFxMessage = signal<string>('');
  serviceChecking = signal<boolean>(false);
  serviceAvailable = signal<boolean>(false);
  serviceError = signal<string>('');
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

  constructor(private toast: ToastService) {}

  async checkHealth(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await fetch(`${this.apiBase}/health`);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { ok: false, message: detail || res.statusText || 'Error en /health' };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, message: err?.message || 'No se pudo conectar al backend' };
    }
  }

  async init(){
    this.serviceChecking.set(true);
    this.serviceError.set('');
    this.serviceAvailable.set(false);
    const health = await this.checkHealth();
    if (!health.ok) {
      this.serviceChecking.set(false);
      this.serviceError.set(health.message || 'No se pudo conectar con el backend');
      return;
    }
    this.serviceAvailable.set(true);
    try {
      await this.loadInitialData();
    } catch (err: any) {
      this.serviceAvailable.set(false);
      this.serviceError.set(err?.message || 'Error al inicializar datos');
    } finally {
      this.serviceChecking.set(false);
    }
  }

  private async loadInitialData(){
    this.trades.set([]);
    this.transfers.set([]);
    this.dividends.set([]);
    this.options.set([]);
    this.baseCurrency.set('USD');
    this.tradeKeys.clear();
    this.tradeIds.clear();
    this.transferIds.clear();
    this.dividendIds.clear();
    await this.loadConfig();
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
    // Enviar filas sin procesar al backend; él clasifica trades/transfers/options.
    const payload = this.normalizeRowsForBackend(data);
    await this.importTradesToBackend(payload as any);
    await this.importTransfersFromBackendPayload(payload as any);
    await this.syncTradesFromBackend();
    await this.syncTransfersFromBackend();
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

  // Precios gestionados por el backend (Yahoo Finance)
  async fetchPricesBatch(tickers: string[]) {
    const unique = this.normalizeTickers(tickers);
    if (!unique.length) return {};
    try {
      // Usar precios ya disponibles en backend sin forzar sincronización para evitar bloqueos en la UI
      const latest = await this.apiPost('/prices/latest', { tickers: unique });
      this.priceErrorShown.delete('batch');
      const out: Record<string, number> = {};
      unique.forEach(t => {
        const info = latest?.[t];
        out[t] = (info && typeof info.close === 'number') ? info.close : 0;
      });
      return out;
    } catch (error: any) {
      console.error('fetchPricesBatch', error);
      if (!this.priceErrorShown.has('batch')) {
        this.toast.warning('No se pudieron obtener los precios desde el backend.');
        this.priceErrorShown.add('batch');
      }
      return unique.reduce((acc, t) => { acc[t] = 0; return acc; }, {} as Record<string, number>);
    }
  }

  async updateAllPrices() {
    const trades = this.trades();
    const opts = this.options();
    const tickers = this.normalizeTickers([
      ...trades.map(t => t.Ticker || ''),
      ...opts.map(o => o.underlying || '')
    ]);
    if (!tickers.length) {
      this.toast.info('No hay tickers para actualizar.');
      return { updated: 0, tickers: [] as string[] };
    }
    try {
      const response = await this.syncBackendPrices(tickers);
      const updatedMap = (response?.updated || {}) as Record<string, number>;
      const total = Object.values(updatedMap).reduce((acc, val) => acc + (typeof val === 'number' ? val : 0), 0);
      this.toast.success(`Precios actualizados desde Yahoo Finance (${tickers.length} tickers).`);
      return { updated: total, tickers };
    } catch (error:any) {
      console.error('updateAllPrices', error);
      const msg = typeof error === 'string' ? error : error?.message || 'No se pudieron actualizar los precios.';
      this.toast.error(msg);
      return { updated: 0, tickers };
    }
  }

  async updatePricesForTicker(ticker: string) {
    const [normalized] = this.normalizeTickers([ticker]);
    if (!normalized) return { updated: 0 };
    try {
      await this.syncBackendPrices([normalized]);
      return { updated: 1 };
    } catch (error:any) {
      console.error('updatePricesForTicker', error);
      const msg = typeof error === 'string' ? error : error?.message || `No se pudo actualizar ${normalized}.`;
      this.toast.error(msg);
      return { updated: 0 };
    }
  }

  async getPricesSeries(ticker: string): Promise<{ date: Date, close: number, provisional?: boolean }[]> {
    const [normalized] = this.normalizeTickers([ticker]);
    if (!normalized) return [];
    try {
      const rows = await this.apiGet(`/prices/${encodeURIComponent(normalized)}`);
      this.priceErrorShown.delete(`series:${normalized}`);
      if (!Array.isArray(rows)) return [];
      return rows.map((row:any) => ({
        date: new Date(row.date),
        close: Number(row.close) || 0,
        provisional: !!row.provisional
      })).filter(item => !isNaN(item.date.getTime()));
    } catch (error) {
      console.error('getPricesSeries', error);
      if (!this.priceErrorShown.has(`series:${normalized}`)) {
        this.toast.warning(`No se pudieron obtener los precios de ${normalized}.`);
        this.priceErrorShown.add(`series:${normalized}`);
      }
      return [];
    }
  }

  private normalizeTickers(list: string[]): string[] {
    return Array.from(new Set((list || []).map(t => String(t || '').toUpperCase()).filter(Boolean)));
  }

  private async syncBackendPrices(tickers: string[]){
    const unique = this.normalizeTickers(tickers);
    if (!unique.length) return { updated: {} };
    return this.apiPost('/prices/sync', { tickers: unique });
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
        Amount: Number(item.amount) || 0,
        origin: (item.origin || 'externo'),
        kind: (item.kind || 'desconocido')
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
      const options = remote
        .filter((item:any) => (item.asset_class || '').toUpperCase() === 'OPT')
        .map((item:any) => this.mapOptionFromTrade(item))
        .filter((o:any) => o.OptionID && o.DateTime instanceof Date);
      this.options.set(options);
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

  async loadConfig(): Promise<{ baseCurrency: string }> {
    try {
      const cfg = await this.apiGet('/config');
      const cur = (cfg?.base_currency || cfg?.baseCurrency || 'USD').toString().toUpperCase();
      this.baseCurrency.set(cur);
      return { baseCurrency: cur };
    } catch (error) {
      console.error('loadConfig', error);
      return { baseCurrency: this.baseCurrency() };
    }
  }

  async updateBaseCurrency(currency: string) {
    const cur = (currency || '').toUpperCase().trim();
    if (!cur) return;
    await this.apiPost('/config/base-currency', { currency: cur });
    this.baseCurrency.set(cur);
    this.toast.success(`Moneda base actualizada a ${cur}`);
  }

  async syncFx(currencies?: string[]) {
    const clean = currencies ? Array.from(new Set((currencies || []).map(c => c.toUpperCase()).filter(Boolean))) : [];
    this.syncingFx.set(true);
    this.syncFxMessage.set('');
    try {
      const res = await this.apiPost('/fx/sync', { tickers: clean });
      const synced = res?.updated ? Object.keys(res.updated).join(', ') : (clean.length ? clean.join(', ') : 'auto');
      this.toast.success(`FX sincronizado (${synced})`);
      this.syncFxMessage.set(`FX sincronizado (${synced})`);
      return res;
    } catch (error:any) {
      console.error('syncFx', error);
      this.syncFxMessage.set(error?.message || 'No se pudo sincronizar FX.');
      this.toast.error(error?.message || 'No se pudo sincronizar FX.');
    } finally {
      this.syncingFx.set(false);
    }
  }

  async getNetTransfers(range?: { from?: string; to?: string }) {
    const params = new URLSearchParams();
    if (range?.from) params.set('from_date', range.from);
    if (range?.to) params.set('to_date', range.to);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.apiGet(`/cash/net-transfers${query}`);
  }

  async getPortfolioValueSeries(interval: 'day'|'week'|'month'|'quarter'|'year' = 'day', base?: string) {
    const params = new URLSearchParams({ interval });
    if (base) params.set('base', base.toUpperCase());
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await this.apiGet(`/portfolio/value/series${query}`);
    const series = Array.isArray(res?.series) ? res.series : [];
    return series
      .map((item:any) => ({
        date: new Date(item.date),
        value: Number(item.value_base) || 0,
        transfers: Number(item.transfers_base) || 0,
        pnlPct: Number(item.pnl_pct) || 0
      }))
      .filter(item => !isNaN(item.date.getTime()));
  }

  async getTransfersSeries(interval: 'day'|'month' = 'day', from?: string, to?: string) {
    const params = new URLSearchParams({ interval });
    if (from) params.set('from_date', from);
    if (to) params.set('to_date', to);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await this.apiGet(`/transfers/series${query}`);
    const series = res?.series || {};
    const mapped: Record<string, { date: Date; amount: number; cumulative: number }[]> = {};
    Object.entries(series).forEach(([cur, points]: any) => {
      mapped[cur] = (points || [])
        .map((p: any) => ({
          date: new Date(p.date),
          amount: Number(p.amount) || 0,
          cumulative: Number(p.cumulative) || 0
        }))
        .filter(p => !isNaN(p.date.getTime()))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
    });
    return mapped;
  }

  async getCashBalances() {
    const res = await this.apiGet('/cash/balance');
    return Array.isArray(res?.balances) ? res.balances : [];
  }

  async getCashSeries(interval: 'day'|'month' = 'day', from?: string, to?: string) {
    const params = new URLSearchParams({ interval });
    if (from) params.set('from_date', from);
    if (to) params.set('to_date', to);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await this.apiGet(`/cash/series${query}`);
    const series = res?.series || {};
    const mapped: Record<string, { date: Date; amount: number; cumulative: number }[]> = {};
    Object.entries(series).forEach(([cur, points]: any) => {
      mapped[cur] = (points || [])
        .map((p: any) => ({
          date: new Date(p.date),
          amount: Number(p.amount) || 0,
          cumulative: Number(p.cumulative) || 0
        }))
        .filter(p => !isNaN(p.date.getTime()))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
    });
    return mapped;
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

  private mapOptionFromTrade(row:any): OptionRow {
    let raw: any = {};
    try { raw = row.raw_json ? JSON.parse(row.raw_json) : {}; } catch (_) { raw = {}; }
    const dt = row.datetime || raw.DateTime || raw['Date/Time'];
    const sideRaw = (raw.side || raw.Side || '').toUpperCase();
    const qty = Math.abs(Number(raw.contracts || raw.Contracts || row.quantity || 0)) || 0;
    const multiplier = Number(raw.multiplier || raw.calcMultiplier || 100) || 100;
    const premiumGross = Number(raw.premiumGross || raw.PremiumGross || (row.purchase && qty ? qty * Number(row.purchase) * multiplier : 0)) || 0;
    const currency = (row.currency || raw.currencyPrimary || raw.CurrencyPrimary || '').toString().toUpperCase() || 'USD';
    return {
      OptionID: row.trade_id || raw.OptionID || raw.trade_id,
      underlying: (raw.underlying || raw.Underlying || this.extractUnderlyingFromSymbol(row.ticker || '') || '').toString().toUpperCase(),
      symbol: raw.symbol || raw.Symbol || row.ticker || '',
      side: sideRaw === 'SELL' ? 'SELL' : 'BUY',
      contracts: qty,
      tradePrice: Number(raw.tradePrice || raw.TradePrice || row.purchase || 0) || 0,
      multiplier,
      premiumGross,
      commission: Number(row.commission || raw.commission || 0) || 0,
      commissionCurrency: (row.commission_currency || raw.commissionCurrency || '').toString().toUpperCase() || undefined,
      currencyPrimary: currency,
      DateTime: dt ? new Date(dt) : null as any,
      execId: raw.execId || raw.ExecID || undefined,
      expiry: raw.expiry ? new Date(raw.expiry) : undefined,
      optType: (raw.optType || raw.Type || '').toUpperCase() as any,
      strike: raw.strike ? Number(raw.strike) : undefined,
      calcMultiplier: raw.calcMultiplier ? Number(raw.calcMultiplier) : undefined,
      notional: raw.notional ? Number(raw.notional) : undefined
    };
  }
}
