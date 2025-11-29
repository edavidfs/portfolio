import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DataService, TradeRow, DividendRow, OptionRow } from '../../services/data.service';
import { TooltipIconComponent } from '../tooltip-icon/tooltip-icon.component';

@Component({
  selector: 'app-ticker-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, TooltipIconComponent],
  template: `
  <div class="space-y-6 p-6">
    <a routerLink="/" class="text-sm text-blue-700">← Volver</a>
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold">Detalle de {{ ticker }}</h2>
    </div>
    
    <div class="container mx-auto">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-medium text-gray-700">Gráfica del activo</h3>
        <button class="ml-2 inline-flex items-center px-3 py-1.5 border text-sm rounded hover:bg-gray-100" [disabled]="updating" (click)="onUpdatePrices()" title="Actualizar precios y redibujar">{{ updating ? 'Actualizando…' : 'Actualizar precios' }}</button>
      </div>
      <canvas id="tickerValueChart" height="70"></canvas>
      <div class="mt-2 flex flex-wrap items-center gap-4 text-sm">
        <label class="inline-flex items-center gap-1"><input type="checkbox" [checked]="showValue" (change)="toggle('value', $any($event.target).checked)" /> Valor</label>
        <label class="inline-flex items-center gap-1"><input type="checkbox" [checked]="showDividends" (change)="toggle('dividends', $any($event.target).checked)" /> Dividendos</label>
        <label class="inline-flex items-center gap-1"><input type="checkbox" [checked]="showPremiums" (change)="toggle('premiums', $any($event.target).checked)" /> Primas</label>
        <label class="inline-flex items-center gap-1"><input type="checkbox" [checked]="showPl" (change)="toggle('pl', $any($event.target).checked)" /> P/L realizado</label>
        <label class="inline-flex items-center gap-1"><input type="checkbox" [checked]="showBase" (change)="toggle('base', $any($event.target).checked)" /> Base neta</label>
        <label class="inline-flex items-center gap-1"><input type="checkbox" [checked]="showDrawdown" (change)="toggle('drawdown', $any($event.target).checked)" /> Drawdown</label>
        <label class="inline-flex items-center gap-1"><input type="checkbox" [checked]="showCashFlow" (change)="toggle('cash', $any($event.target).checked)" /> Flujo (por moneda)</label>
      </div>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Acciones actuales en cartera tras aplicar FIFO a las compras/ventas de acciones (STK)"></app-tooltip-icon>
        <div class="text-xs text-gray-500">Acciones actuales</div>
        <div class="text-lg font-medium">{{ summary.currentQty | number:'1.0-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Precio medio de coste de las acciones que quedan en cartera (FIFO)"></app-tooltip-icon>
        <div class="text-xs text-gray-500">Precio medio (costo)</div>
        <div class="text-lg font-medium">{{ summary.avgCost | number:'1.2-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Beneficio realizado por ventas (precio de venta – coste FIFO – comisiones)"></app-tooltip-icon>
        <div class="text-xs text-gray-500">Beneficio realizado</div>
        <div class="text-lg font-medium">{{ summary.realizedProfit | number:'1.2-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Suma de dividendos cobrados en los últimos 12 meses"></app-tooltip-icon>
        <div class="text-xs text-gray-500">Dividendo 12m</div>
        <div class="text-lg font-medium">{{ summary.divLast12m | number:'1.2-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Suma total de dividendos cobrados"></app-tooltip-icon>
        <div class="text-xs text-gray-500">Dividendo total</div>
        <div class="text-lg font-medium">{{ summary.divTotal | number:'1.2-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Suma de comisiones de operaciones STK + OPT"></app-tooltip-icon>
        <div class="text-xs text-gray-500">Comisiones pagadas</div>
        <div class="text-lg font-medium">{{ summary.commissions | number:'1.2-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Capital neto invertido = –(compras/ventas STK + dividendos + prima neta de opciones, incluyendo sus comisiones)"></app-tooltip-icon>
        <div class="text-xs text-gray-500">Capital neto invertido</div>
        <div class="text-lg font-medium">{{ summary.baseCost | number:'1.2-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Base/acción = capital neto invertido dividido por acciones actuales (opciones y sus comisiones incluidas en el neto)"></app-tooltip-icon>
        <div class="text-xs text-gray-500">Base/acción</div>
        <div class="text-lg font-medium">{{ summary.baseCostPerShare | number:'1.2-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Prima neta de opciones = primas cobradas – primas pagadas (incluye comisiones)"></app-tooltip-icon>
        <div class="text-xs text-gray-500">Prima neta OPT</div>
        <div class="text-lg font-medium">{{ optionsSummary.premiumNet | number:'1.2-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Contratos y nocional de puts/calls (strike × multiplicador × contratos)"></app-tooltip-icon>
        <div class="text-xs text-gray-500">Puts/Calls (contratos)</div>
        <div class="text-lg font-medium">{{ optionsSummary.putsContracts || 0 }} / {{ optionsSummary.callsContracts || 0 }}</div>
        <div class="mt-1 text-xs text-gray-500">Nocional P/C: {{ (optionsSummary.putsNotional || 0) | number:'1.0-0' }} / {{ (optionsSummary.callsNotional || 0) | number:'1.0-0' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="% de beneficio total (valor actual + realizado) respecto al capital neto invertido (base)"></app-tooltip-icon>
        <div class="text-xs text-gray-500">% Beneficio vs Base</div>
        <div class="text-lg font-medium">{{ roiBasePct | percent:'1.2-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="% de beneficio total (valor actual + realizado) respecto a compras/ventas de acciones (solo STK)"></app-tooltip-icon>
        <div class="text-xs text-gray-500">% Beneficio vs STK</div>
        <div class="text-lg font-medium">{{ roiStkPct | percent:'1.2-2' }}</div>
      </div>
      <div class="bg-white rounded border p-3 relative">
        <app-tooltip-icon text="Último día con precio almacenado en la base local"></app-tooltip-icon>
      <div class="text-xs text-gray-500">Último día con precio</div>
        <div class="text-lg font-medium">{{ summary.lastPriceDate ? (summary.lastPriceDate | date:'dd/MM/yyyy') : '-' }}</div>
      </div>
    </div>

    <div>
      <h3 class="text-sm font-medium text-gray-700 mb-2">Operaciones</h3>
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cantidad</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Precio</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comisión</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr *ngFor="let r of tradeRows">
            <td class="px-3 py-1">{{ r.DateTime ? (r.DateTime | date:'dd/MM/yyyy HH:mm') : '' }}</td>
            <td class="px-3 py-1">{{ (r.Quantity || 0) >= 0 ? 'Compra' : 'Venta' }}</td>
            <td class="px-3 py-1">{{ r.Quantity | number:'1.0-2' }}</td>
            <td class="px-3 py-1">{{ r.PurchasePrice | number:'1.2-2' }}</td>
            <td class="px-3 py-1">{{ (r.Commission||0) | number:'1.2-2' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div>
      <h3 class="text-sm font-medium text-gray-700 mb-2">Dividendos</h3>
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Importe</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Moneda</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Impuesto</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr *ngFor="let d of dividendRows">
            <td class="px-3 py-1">{{ d.DateTime | date:'dd/MM/yyyy' }}</td>
            <td class="px-3 py-1">{{ d.Amount | number:'1.2-2' }}</td>
            <td class="px-3 py-1">{{ d.CurrencyPrimary }}</td>
            <td class="px-3 py-1">{{ d.Tax | number:'1.2-2' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div>
      <h3 class="text-sm font-medium text-gray-700 mb-2">Opciones (primas)</h3>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-3">
        <div class="bg-white rounded border p-3 relative">
          <app-tooltip-icon text="Suma de primas cobradas (ventas de opciones)"></app-tooltip-icon>
          <div class="text-xs text-gray-500">Primas cobradas</div>
          <div class="text-lg font-medium">{{ optionsSummary.premiumReceived | number:'1.2-2' }}</div>
        </div>
        <div class="bg-white rounded border p-3 relative">
          <app-tooltip-icon text="Suma de primas pagadas (compras de opciones)"></app-tooltip-icon>
          <div class="text-xs text-gray-500">Primas pagadas</div>
          <div class="text-lg font-medium">{{ optionsSummary.premiumPaid | number:'1.2-2' }}</div>
        </div>
        <div class="bg-white rounded border p-3 relative">
          <app-tooltip-icon text="Primas cobradas – primas pagadas"></app-tooltip-icon>
          <div class="text-xs text-gray-500">Prima neta</div>
          <div class="text-lg font-medium">{{ optionsSummary.premiumNet | number:'1.2-2' }}</div>
        </div>
        <div class="bg-white rounded border p-3 relative">
          <app-tooltip-icon text="Número total de contratos de opciones negociados"></app-tooltip-icon>
          <div class="text-xs text-gray-500">Contratos</div>
          <div class="text-lg font-medium">{{ optionsSummary.contracts }}</div>
        </div>
        <div class="bg-white rounded border p-3 relative">
          <app-tooltip-icon text="Suma de comisiones de opciones (absoluta)"></app-tooltip-icon>
          <div class="text-xs text-gray-500">Comisiones OPT</div>
          <div class="text-lg font-medium">{{ optionsSummary.commissionTotal | number:'1.2-2' }}</div>
        </div>
      </div>
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Símbolo</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Strike</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IBExecID</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lado</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contratos</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Precio</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Multip.</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prima bruta</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comisión</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Moneda</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr *ngFor="let o of optionRows">
            <td class="px-3 py-1">{{ o.DateTime | date:'dd/MM/yyyy HH:mm' }}</td>
            <td class="px-3 py-1">{{ o.symbol }}</td>
            <td class="px-3 py-1">{{ o.optType || '-' }}</td>
            <td class="px-3 py-1">{{ (o.strike || 0) | number:'1.2-2' }}</td>
            <td class="px-3 py-1">{{ o.execId || (o.OptionID?.split(':')[1] || '') }}</td>
            <td class="px-3 py-1">{{ o.side }}</td>
            <td class="px-3 py-1">{{ o.contracts }}</td>
            <td class="px-3 py-1">{{ o.tradePrice | number:'1.2-2' }}</td>
            <td class="px-3 py-1">{{ o.multiplier }}</td>
            <td class="px-3 py-1">{{ o.premiumGross | number:'1.2-2' }}</td>
            <td class="px-3 py-1">{{ o.commission | number:'1.2-2' }}</td>
            <td class="px-3 py-1">{{ o.currencyPrimary }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  `
})
export class TickerDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private data = inject(DataService);
  ticker = '';
  tradeRows: TradeRow[] = [];
  dividendRows: DividendRow[] = [];
  summary: { currentQty: number; avgCost: number; realizedProfit: number; divLast12m: number; divTotal: number; commissions: number; baseCost: number; baseCostPerShare: number; lastPriceDate: Date | null } = { currentQty: 0, avgCost: 0, realizedProfit: 0, divLast12m: 0, divTotal: 0, commissions: 0, baseCost: 0, baseCostPerShare: 0, lastPriceDate: null };
  private valueChart: any;
  selectedChart: 'valor'|'dividendos'|'primas' = 'valor';
  chartTitle = 'Valor diario (precio × acciones)';
  private yearBoundaryPlugin = this.buildYearBoundaryPlugin();
  private sub: any;
  optionRows: OptionRow[] = [];
  optionsSummary = { premiumReceived: 0, premiumPaid: 0, premiumNet: 0, contracts: 0 } as any;
  updating = false;
  roiBasePct = 0;
  roiStkPct = 0;
  showCashFlow = false;
  showValue = true;
  showDividends = false;
  showPremiums = false;
  showPl = false;
  showBase = false;
  showDrawdown = false;

  ngOnInit(){
    this.sub = this.route.paramMap.subscribe(params => {
      const t = params.get('ticker') || '';
      this.loadTicker(t);
    });
  }

  ngOnDestroy(){ if (this.sub) this.sub.unsubscribe(); if (this.valueChart) this.valueChart.destroy(); }

  private async loadTicker(ticker:string){
    this.ticker = ticker;
    const allTrades = this.data.trades();
    const allDivs = this.data.dividends();
    this.tradeRows = allTrades.filter(t => t.Ticker === this.ticker).sort((a,b)=> (a.DateTime?.getTime?.()||0) - (b.DateTime?.getTime?.()||0));
    this.dividendRows = allDivs.filter(d => (d.Ticker||'') === this.ticker).sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());

    const agg = this.data.aggregateTradesFifoByTicker(this.tradeRows);
    const stats = this.data.computeDividendStats(this.dividendRows);
    const flows = this.data.computeTradeCashFlowByTicker(this.tradeRows);
    const t = (agg as any)[this.ticker] || { currentQty: 0, avgCost: 0, realizedProfit: 0 };
    const div:any = (stats as any)[this.ticker] || { total: 0, last12m: 0 };
    const flow = (flows as any)[this.ticker] || 0;
    const commissionsStk = this.tradeRows.reduce((acc, r) => acc + Math.abs(Number(r.Commission) || 0), 0);
    // Opciones asociadas al subyacente
    const opts = this.data.options();
    this.optionRows = opts.filter(o => o.underlying === this.ticker).sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
    const premTotals = this.optionRows.reduce((acc:any, o) => {
      const inSame = !o.commissionCurrency || o.commissionCurrency === o.currencyPrimary;
      const net = (o.side === 'SELL' ? +o.premiumGross : -o.premiumGross) + (inSame ? (o.commission||0) : 0);
      if (net >= 0) acc.premiumReceived += net; else acc.premiumPaid += -net;
      acc.contracts += o.contracts;
      acc.commissionTotal += Math.abs(Number(o.commission)||0);
      return acc;
    }, { premiumReceived: 0, premiumPaid: 0, premiumNet: 0, contracts: 0, commissionTotal: 0 });
    premTotals.premiumNet = premTotals.premiumReceived - premTotals.premiumPaid;
    this.optionsSummary = premTotals;
    // Estadísticas de puts/calls y nocional por subyacente
    const optStatsMap = this.data.computeOptionStatsByUnderlying(this.optionRows as any);
    const st = (optStatsMap as any)[this.ticker] || { putsContracts:0, callsContracts:0, putsNotional:0, callsNotional:0, netNotional:0 };
    (this.optionsSummary as any).putsContracts = st.putsContracts;
    (this.optionsSummary as any).callsContracts = st.callsContracts;
    (this.optionsSummary as any).putsNotional = st.putsNotional;
    (this.optionsSummary as any).callsNotional = st.callsNotional;
    (this.optionsSummary as any).netNotional = st.netNotional;
    const commissionsOptAbs = premTotals.commissionTotal || 0;
    const baseCost = - (flow + (div.total || 0) + (premTotals.premiumNet || 0));
    const baseCostPerShare = t.currentQty > 0 ? baseCost / t.currentQty : 0;
    this.summary = { currentQty: t.currentQty, avgCost: t.avgCost, realizedProfit: t.realizedProfit, divLast12m: div.last12m || 0, divTotal: div.total || 0, commissions: commissionsStk + commissionsOptAbs, baseCost, baseCostPerShare, lastPriceDate: this.summary.lastPriceDate };

    await this.drawCombinedChart();
  }

  async onUpdatePrices(){
    if (!this.ticker || this.updating) return;
    this.updating = true;
    try {
      await this.data.updatePricesForTicker(this.ticker);
      await this.drawCombinedChart();
    } finally {
      this.updating = false;
    }
  }

  

  private buildYearBoundaryPlugin(){
    return {
      id: 'yearBoundaries',
      afterDatasetsDraw: (chart:any) => {
        const xScale = chart.scales?.x;
        const area = chart.chartArea;
        if (!xScale || !area) return;
        const min = xScale.min;
        const max = xScale.max;
        if (min == null || max == null) return;
        const ctx = chart.ctx as CanvasRenderingContext2D;
        const startYear = new Date(min).getFullYear();
        let d = new Date(startYear + 1, 0, 1, 0, 0, 0, 0);
        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.setLineDash([4, 4]);
        while (d.getTime() < max) {
          const x = xScale.getPixelForValue(d.getTime());
          ctx.beginPath();
          ctx.moveTo(x, area.top);
          ctx.lineTo(x, area.bottom);
          ctx.stroke();
          d = new Date(d.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
        }
        ctx.restore();
      }
    };
  }

  private async drawDailyValueChart(){
    const prices = await this.data.getPricesSeries(this.ticker);
    const last = prices.length ? prices[prices.length - 1].date : null;
    this.summary.lastPriceDate = last || null;
    if (!prices.length) { if (this.valueChart) { this.valueChart.destroy(); this.valueChart = null; } this.roiBasePct = 0; this.roiStkPct = 0; return; }
    // Cantidad diaria acumulada por fecha
    const events: Record<string, number> = {};
    this.tradeRows.forEach(r => { const k = (r.DateTime as Date).toISOString().slice(0,10); events[k] = (events[k]||0) + (Number(r.Quantity)||0); });
    const allDays = Array.from(new Set([...Object.keys(events), ...prices.map(p=> p.date.toISOString().slice(0,10))])).sort();
    let acc = 0; const qtyByDay: Record<string, number> = {};
    allDays.forEach(k => { acc += (events[k]||0); qtyByDay[k] = acc; });
    const series = prices.map(p => { const k = p.date.toISOString().slice(0,10); const q = qtyByDay[k] ?? acc; return { x: p.date, y: (q||0) * (p.close||0) }; });
    // Calcular % beneficio sobre base y sobre STK
    const lastClose = prices[prices.length - 1]?.close || 0;
    const currentValue = (this.summary.currentQty || 0) * lastClose;
    const totalValue = currentValue + (this.summary.realizedProfit || 0);
    const base = this.summary.baseCost || 0;
    this.roiBasePct = base > 0 ? (totalValue - base) / base : 0;
    const flowMap = this.data.computeTradeCashFlowByTicker(this.tradeRows as any);
    const flow = (flowMap as any)[this.ticker] || 0;
    const baseStk = -flow;
    this.roiStkPct = baseStk > 0 ? (totalValue - baseStk) / baseStk : 0;
    const canvas:any = document.getElementById('tickerValueChart'); if (!canvas) return; const ctx = canvas.getContext('2d');
    if (this.valueChart) this.valueChart.destroy();
    this.valueChart = new (window as any).Chart(ctx, { type: 'line', data: { datasets: [{ label: 'Valor diario (precio × acciones)', data: series, borderColor: 'rgba(99,102,241,1)', backgroundColor: 'rgba(99,102,241,0.2)', fill: false }] }, options: { responsive: true, scales: { x: { type: 'time', time: { unit: 'day' } }, y: { beginAtZero: true } } }, plugins: [this.yearBoundaryPlugin] });
  }

  private async drawDividendsChart(){
    const rows = this.dividendRows.slice().sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
    if (!rows.length) { if (this.valueChart) { this.valueChart.destroy(); this.valueChart = null; } return; }
    const daily: Record<string, number> = {};
    rows.forEach(r => { const k = r.DateTime.toISOString().slice(0,10); daily[k] = (daily[k]||0) + (Number(r.Amount)||0); });
    const series = Object.keys(daily).sort().map(k => ({ x: new Date(k), y: daily[k] }));
    const canvas:any = document.getElementById('tickerValueChart'); if (!canvas) return; const ctx = canvas.getContext('2d');
    if (this.valueChart) this.valueChart.destroy();
    this.valueChart = new (window as any).Chart(ctx, { type: 'bar', data: { datasets: [{ label: 'Dividendos por día', data: series, backgroundColor: 'rgba(34,197,94,0.4)', borderColor: 'rgba(34,197,94,1)' }] }, options: { responsive: true, scales: { x: { type: 'time', time: { unit: 'month' } }, y: { beginAtZero: true } } }, plugins: [this.yearBoundaryPlugin] });
  }

  private async drawPremiumsChart(){
    const opts = this.optionRows.slice().sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
    if (!opts.length) { if (this.valueChart) { this.valueChart.destroy(); this.valueChart = null; } return; }
    const received: {x:Date,y:number}[] = [];
    const paid: {x:Date,y:number}[] = [];
    let accRec = 0, accPaid = 0;
    opts.forEach(o => {
      const gross = Number(o.premiumGross)||0;
      const comm = Number(o.commission)||0;
      const net = (o.side === 'SELL' ? +gross : -gross) + comm;
      if (net >= 0) { accRec += net; received.push({ x: o.DateTime, y: accRec }); paid.push({ x: o.DateTime, y: accPaid }); }
      else { accPaid += -net; paid.push({ x: o.DateTime, y: accPaid }); received.push({ x: o.DateTime, y: accRec }); }
    });
    const canvas:any = document.getElementById('tickerValueChart'); if (!canvas) return; const ctx = canvas.getContext('2d');
    if (this.valueChart) this.valueChart.destroy();
    this.valueChart = new (window as any).Chart(ctx, { type: 'line', data: { datasets: [
      { label: 'Primas cobradas (acum.)', data: received, borderColor: 'rgba(34,197,94,1)', backgroundColor: 'rgba(34,197,94,0.3)', fill: false },
      { label: 'Primas pagadas (acum.)', data: paid, borderColor: 'rgba(239,68,68,1)', backgroundColor: 'rgba(239,68,68,0.3)', fill: false }
    ]}, options: { responsive: true, scales: { x: { type: 'time', time: { unit: 'month' } }, y: { beginAtZero: true } } }, plugins: [this.yearBoundaryPlugin] });
  }
  private async drawCombinedChart(){
    const datasets:any[] = [];
    const canvas:any = document.getElementById('tickerValueChart'); if (!canvas) return; const ctx = canvas.getContext('2d');
    const prices = await this.data.getPricesSeries(this.ticker);
    const last = prices.length ? prices[prices.length - 1].date : null;
    this.summary.lastPriceDate = last || null;
    // Cantidad diaria acumulada para valor y drawdown
    const events: Record<string, number> = {};
    this.tradeRows.forEach(r=>{ const k=(r.DateTime as Date).toISOString().slice(0,10); events[k]=(events[k]||0)+(Number(r.Quantity)||0); });
    const allDays = Array.from(new Set([ ...Object.keys(events), ...prices.map(p=> p.date.toISOString().slice(0,10)) ])).sort();
    let acc=0; const qtyByDay: Record<string, number> = {}; allDays.forEach(k=>{ acc+=(events[k]||0); qtyByDay[k]=acc; });
    // Valor diario
    if (this.showValue && prices.length){
      const valueSeries = prices.map(p=>{ const k=p.date.toISOString().slice(0,10); const q=qtyByDay[k] ?? acc; return { x:p.date, y:(q||0)*(p.close||0) }; });
      datasets.push({ type:'line', label:'Valor diario', data:valueSeries, borderColor:'rgba(99,102,241,1)', backgroundColor:'rgba(99,102,241,0.15)', fill:false, yAxisID:'y' });
      // KPIs ROI
      const lastClose = prices[prices.length - 1]?.close || 0;
      const currentValue = (this.summary.currentQty || 0) * lastClose;
      const totalValue = currentValue + (this.summary.realizedProfit || 0);
      const base = this.summary.baseCost || 0;
      this.roiBasePct = base > 0 ? (totalValue - base) / base : 0;
      const flowMap = this.data.computeTradeCashFlowByTicker(this.tradeRows as any);
      const flow = (flowMap as any)[this.ticker] || 0;
      const baseStk = -flow; this.roiStkPct = baseStk > 0 ? (totalValue - baseStk) / baseStk : 0;
    } else { this.roiBasePct = 0; this.roiStkPct = 0; }
    // Dividendos diarios
    if (this.showDividends){
      const daily: Record<string, number> = {};
      this.dividendRows.forEach(r=>{ const k=r.DateTime.toISOString().slice(0,10); daily[k]=(daily[k]||0)+(Number(r.Amount)||0); });
      const divSeries = Object.keys(daily).sort().map(k=>({ x:new Date(k), y: daily[k] }));
      datasets.push({ type:'bar', label:'Dividendos por día', data: divSeries, backgroundColor:'rgba(34,197,94,0.4)', borderColor:'rgba(34,197,94,1)', yAxisID:'y' });
    }
    // Primas acumuladas
    if (this.showPremiums){
      const opts = this.optionRows.slice().sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
      let accRec=0, accPaid=0; const received:any[]=[]; const paid:any[]=[];
      opts.forEach(o=>{ const gross=Number(o.premiumGross)||0; const comm=Number(o.commission)||0; const net=(o.side==='SELL'? +gross : -gross)+comm; if (net>=0){ accRec+=net; received.push({x:o.DateTime,y:accRec}); paid.push({x:o.DateTime,y:accPaid}); } else { accPaid+=-net; paid.push({x:o.DateTime,y:accPaid}); received.push({x:o.DateTime,y:accRec}); } });
      datasets.push({ type:'line', label:'Primas cobradas (acum.)', data: received, borderColor:'rgba(34,197,94,1)', backgroundColor:'rgba(34,197,94,0.3)', fill:false, yAxisID:'y' });
      datasets.push({ type:'line', label:'Primas pagadas (acum.)', data: paid, borderColor:'rgba(239,68,68,1)', backgroundColor:'rgba(239,68,68,0.3)', fill:false, yAxisID:'y' });
    }
    // P/L realizado acumulado
    if (this.showPl){
      const trades = this.tradeRows.slice().sort((a,b)=> (a.DateTime?.getTime?.()||0) - (b.DateTime?.getTime?.()||0));
      const lots: {qty:number;cps:number}[] = []; let realized=0; const plSeries:any[] = [];
      trades.forEach(r=>{ const q=Number(r.Quantity)||0; const p=Number(r.PurchasePrice)||0; const comm=Math.abs(Number(r.Commission)||0); if (q>0){ const tc=q*p+comm; const cps= q>0? tc/q : 0; lots.push({qty:q,cps}); } else if (q<0){ let sellQty=-q; while(sellQty>0 && lots.length>0){ const lot=lots[0]; const take=Math.min(lot.qty, sellQty); realized += take * (p - lot.cps); lot.qty -= take; sellQty -= take; if (lot.qty<=1e-7) lots.shift(); } realized -= comm; plSeries.push({ x: r.DateTime as Date, y: realized }); } });
      datasets.push({ type:'line', label:'P/L realizado (acum.)', data: plSeries, borderColor:'rgba(59,130,246,1)', backgroundColor:'rgba(59,130,246,0.2)', fill:false, yAxisID:'y' });
    }
    // Base neta
    if (this.showBase){
      const trades = this.tradeRows, divs = this.dividendRows, opts = this.optionRows; const daysSet = new Set<string>(); const flowDaily: Record<string, number> = {};
      const add=(k:string,v:number)=>{ flowDaily[k]=(flowDaily[k]||0)+v; daysSet.add(k); };
      trades.forEach(r=>{ const k=(r.DateTime as Date).toISOString().slice(0,10); const qty=Number(r.Quantity)||0; const price=Number(r.PurchasePrice)||0; const comm=(r.CommissionCurrency && r.CommissionCurrency!==r.CurrencyPrimary)?0:(Number(r.Commission)||0); const amount= qty>0? -(qty*price)+comm : (-qty*price)+comm; add(k, amount); });
      divs.forEach(d=>{ const k=d.DateTime.toISOString().slice(0,10); add(k, Number(d.Amount)||0); });
      opts.forEach(o=>{ const k=o.DateTime.toISOString().slice(0,10); const net=(o.side==='SELL'? +o.premiumGross : -o.premiumGross) + (o.commission||0); add(k, net); });
      const days = Array.from(daysSet).sort(); let baseAcc=0; const baseSeries = days.map(k=>{ baseAcc += (flowDaily[k]||0); return { x: new Date(k), y: -baseAcc }; });
      datasets.push({ type:'line', label:'Base neta (–flujos acumulados)', data: baseSeries, borderColor:'rgba(156,163,175,1)', backgroundColor:'rgba(156,163,175,0.15)', fill:false, yAxisID:'y' });
    }
    // Drawdown
    if (this.showDrawdown && prices.length){ let peak=0; const ddSeries = prices.map(p=>{ const k=p.date.toISOString().slice(0,10); const q=qtyByDay[k] ?? acc; const val=(q||0)*(p.close||0); peak=Math.max(peak, val); const dd=peak>0?(val/peak-1):0; return { x:p.date, y: dd }; }); datasets.push({ type:'line', label:'Drawdown', data: ddSeries, borderColor:'rgba(244,63,94,1)', backgroundColor:'rgba(244,63,94,0.15)', fill:true, yAxisID:'y2' }); }
    // Flujo por moneda (acumulado)
    if (this.showCashFlow){
      type Row = { DateTime: Date; Amount: number; CurrencyPrimary: string };
      const tradeFlows: Row[] = this.tradeRows
        .filter(r => r && r.DateTime && r.CurrencyPrimary != null)
        .map(r => {
          const qty = Number(r.Quantity) || 0;
          const price = Number(r.PurchasePrice) || 0;
          const comm = (r.CommissionCurrency && r.CommissionCurrency !== r.CurrencyPrimary) ? 0 : (Number(r.Commission) || 0);
          const amount = qty > 0 ? -(qty * price) + comm : (-qty * price) + comm;
          return { DateTime: r.DateTime as Date, Amount: amount, CurrencyPrimary: r.CurrencyPrimary as string };
        });
      const divFlows: Row[] = this.dividendRows.map(d => ({ DateTime: d.DateTime, Amount: d.Amount, CurrencyPrimary: d.CurrencyPrimary }));
      const optFlows: Row[] = this.optionRows.map(o => {
        const net = (o.side === 'SELL' ? +o.premiumGross : -o.premiumGross) + (o.commission || 0);
        return { DateTime: o.DateTime, Amount: net, CurrencyPrimary: o.currencyPrimary };
      });
      const all: Row[] = [...tradeFlows, ...divFlows, ...optFlows].sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
      const daily: Record<string, Record<string, number>> = {};
      all.forEach(r => {
        const cur = r.CurrencyPrimary;
        const dkey = r.DateTime.toISOString().slice(0, 10);
        if (!daily[cur]) daily[cur] = {};
        daily[cur][dkey] = (daily[cur][dkey] || 0) + (Number(r.Amount) || 0);
      });
      const colors = ['rgba(75, 192, 192, 1)','rgba(54, 162, 235, 1)','rgba(255, 99, 132, 1)','rgba(255, 206, 86, 1)','rgba(153, 102, 255, 1)'];
      Object.keys(daily).forEach((currency, i) => {
        const days = Object.keys(daily[currency]).sort();
        let sAcc = 0;
        const series = days.map(dkey => { sAcc += daily[currency][dkey]; return { x: new Date(dkey), y: sAcc }; });
        datasets.push({ type:'line', label:`Flujo ${currency}`, data: series, borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length], fill:false, yAxisID:'y' });
      });
    }
    if (this.valueChart) this.valueChart.destroy();
    if (!datasets.length){ this.valueChart = null; return; }
    const options:any = { responsive:true, scales:{ x:{ type:'time', time:{ unit:'month' } }, y:{ beginAtZero:true }, y2:{ beginAtZero:true, suggestedMin:-1, suggestedMax:0, display:this.showDrawdown, position:'right', grid:{ drawOnChartArea:false } } } };
    this.valueChart = new (window as any).Chart(ctx, { type:'line', data:{ datasets }, options, plugins:[this.yearBoundaryPlugin] });
  }

  toggle(kind:'value'|'dividends'|'premiums'|'pl'|'base'|'drawdown'|'cash', checked:boolean){
    if (kind==='value') this.showValue = checked;
    else if (kind==='dividends') this.showDividends = checked;
    else if (kind==='premiums') this.showPremiums = checked;
    else if (kind==='pl') this.showPl = checked;
    else if (kind==='base') this.showBase = checked;
    else if (kind==='drawdown') this.showDrawdown = checked;
    else if (kind==='cash') this.showCashFlow = checked;
    this.drawCombinedChart();
  }
}
  
