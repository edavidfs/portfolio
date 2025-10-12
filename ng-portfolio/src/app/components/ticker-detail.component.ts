import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DataService, TradeRow, DividendRow, OptionRow } from '../services/data.service';
import { TooltipIconComponent } from './tooltip-icon.component';

@Component({
  selector: 'app-ticker-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, TooltipIconComponent],
  template: `
  <div class="space-y-6 p-6">
    <a routerLink="/" class="text-sm text-blue-700">← Volver</a>
    <h2 class="text-xl font-semibold">Detalle de {{ ticker }}</h2>
    <div class="container mx-auto">
      <canvas id="tickerCashChart" height="70"></canvas>
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
            <td class="px-3 py-1">{{ r.DateTime ? (r.DateTime | date:'short') : '' }}</td>
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
            <td class="px-3 py-1">{{ d.DateTime | date:'shortDate' }}</td>
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
            <td class="px-3 py-1">{{ o.DateTime | date:'short' }}</td>
            <td class="px-3 py-1">{{ o.symbol }}</td>
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
  summary = { currentQty: 0, avgCost: 0, realizedProfit: 0, divLast12m: 0, divTotal: 0, commissions: 0, baseCost: 0, baseCostPerShare: 0 };
  private chart: any;
  private sub: any;
  optionRows: OptionRow[] = [];
  optionsSummary = { premiumReceived: 0, premiumPaid: 0, premiumNet: 0, contracts: 0 } as any;

  ngOnInit(){
    this.sub = this.route.paramMap.subscribe(params => {
      const t = params.get('ticker') || '';
      this.loadTicker(t);
    });
  }

  ngOnDestroy(){ if (this.sub) this.sub.unsubscribe(); if (this.chart) this.chart.destroy(); }

  private loadTicker(ticker:string){
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
    const commissionsOptAbs = premTotals.commissionTotal || 0;
    const baseCost = - (flow + (div.total || 0) + (premTotals.premiumNet || 0));
    const baseCostPerShare = t.currentQty > 0 ? baseCost / t.currentQty : 0;
    this.summary = { currentQty: t.currentQty, avgCost: t.avgCost, realizedProfit: t.realizedProfit, divLast12m: div.last12m || 0, divTotal: div.total || 0, commissions: commissionsStk + commissionsOptAbs, baseCost, baseCostPerShare };

    this.drawTickerCashChart();
  }

  private drawTickerCashChart(){
    // Construir historial de caja por moneda con operaciones de este ticker + dividendos de este ticker
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
    const histories: Record<string, {x:Date,y:number}[]> = {};
    Object.keys(daily).forEach(cur => {
      const days = Object.keys(daily[cur]).sort();
      let acc = 0;
      histories[cur] = days.map(dkey => {
        acc += daily[cur][dkey];
        return { x: new Date(dkey), y: acc };
      });
    });
    const colors = ['rgba(75, 192, 192, 1)','rgba(54, 162, 235, 1)','rgba(255, 99, 132, 1)','rgba(255, 206, 86, 1)'];
    const datasets = Object.keys(histories).map((currency, i) => ({ label: currency, data: histories[currency], borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length], fill: false }));
    const canvas:any = document.getElementById('tickerCashChart'); if (!canvas) return; const ctx = canvas.getContext('2d');
    if (this.chart) this.chart.destroy();
    if (!datasets.length) { this.chart = null; return; }
    this.chart = new (window as any).Chart(ctx, { type: 'line', data: { datasets }, options: { responsive: true, plugins: { title: { display: true, text: 'Flujo acumulado por moneda (incluye comisiones STK/OPT)', font: { size: 12 } } }, scales: { x: { type: 'time', time: { unit: 'day' } }, y: { beginAtZero: true } } } });
  }
}
