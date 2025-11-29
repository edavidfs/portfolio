import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, Signal, WritableSignal, effect, inject, signal } from '@angular/core';
import { DataService, DividendRow, OptionRow, TradeRow, TransferRow } from '../../services/data.service';
import { ToastService } from '../../services/toast.service';
import { computeSummary } from './dashboard.utils';

type RangeId = '30d' | '90d' | '1y' | 'all';
type IntervalId = 'day' | 'week' | 'month' | 'quarter' | 'year';

interface SeriesPoint { date: Date; value: number; transfers: number; pnlPct: number; }
interface MetricsSummary {
  benefit: number;
  benefitPct: number;
  transfers: number;
  dividends: number;
  optionsPnl: number;
  interestPaid: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent implements OnInit, OnDestroy {
  readonly data = inject(DataService);
  private toast = inject(ToastService);
  private chart: any;
  private lastBaseCurrency = this.data.baseCurrency();

  constructor() {
    effect(() => {
      const currentBase = this.data.baseCurrency();
      if (!currentBase || currentBase === this.lastBaseCurrency) return;
      this.lastBaseCurrency = currentBase;
      void this.refreshSeries();
    });
  }

  loading = signal<boolean>(true);
  series: WritableSignal<SeriesPoint[]> = signal([]);
  filteredSeries: WritableSignal<SeriesPoint[]> = signal([]);
  range: WritableSignal<RangeId> = signal('90d');
  interval: WritableSignal<IntervalId> = signal('month');
  showTransfers = signal<boolean>(true);
  showPnlPct = signal<boolean>(false);
  intervalLabel: Record<IntervalId, string> = {
    day: 'Diario',
    week: 'Semanal',
    month: 'Mensual',
    quarter: 'Trimestral',
    year: 'Anual'
  };

  summary: WritableSignal<MetricsSummary> = signal({
    benefit: 0,
    benefitPct: 0,
    transfers: 0,
    dividends: 0,
    optionsPnl: 0,
    interestPaid: 0
  });

  async ngOnInit(): Promise<void> {
    await this.loadDashboard();
  }

  ngOnDestroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  async loadDashboard() {
    this.loading.set(true);
    try {
      await this.refreshSeries();
      const trades = this.data.trades();
      const transfers = this.data.transfers();
      const dividends = this.data.dividends();
      const options = this.data.options();
      const summary = await this.buildSummary(trades, transfers, dividends, options);
      this.summary.set(summary);
    } finally {
      this.loading.set(false);
    }
  }

  setRange(id: RangeId) {
    this.range.set(id);
    this.applyRange();
    this.drawChart();
  }

  toggleShowTransfers(v: boolean) {
    this.showTransfers.set(v);
    this.drawChart();
  }

  toggleShowPnlPct(v: boolean) {
    this.showPnlPct.set(v);
    this.drawChart();
  }

  async setInterval(id: IntervalId) {
    if (this.interval() === id && this.series().length) return;
    this.interval.set(id);
    this.loading.set(true);
    try {
      await this.refreshSeries();
    } finally {
      this.loading.set(false);
    }
  }

  private applyRange() {
    const id = this.range();
    const all = this.series();
    if (!all.length) {
      this.filteredSeries.set([]);
      return;
    }
    if (id === 'all') {
      this.filteredSeries.set(all);
      return;
    }
    const days = id === '30d' ? 30 : id === '90d' ? 90 : 365;
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - days);
    this.filteredSeries.set(all.filter(p => p.date >= minDate));
  }

  private async refreshSeries() {
    const previous = this.series();
    try {
      const interval = this.interval();
      const base = this.data.baseCurrency();
      const remote = await this.data.getPortfolioValueSeries(interval, base);
      const sorted = remote.slice().sort((a, b) => a.date.getTime() - b.date.getTime());
      let cumulativeTransfers = 0;
      const mapped = sorted.map(item => {
        cumulativeTransfers += item.transfers;
        return {
          date: item.date,
          value: item.value,
          transfers: cumulativeTransfers,
          pnlPct: item.pnlPct
        };
      });
      this.series.set(mapped);
      this.applyRange();
      this.drawChart();
    } catch (error: any) {
      console.error('refreshSeries', error);
      const msg = error?.message || 'No se pudo obtener la serie del portafolio.';
      this.toast.warning(msg);
      // Mantener la última serie conocida para evitar perder la gráfica
      this.series.set(previous || []);
      this.applyRange();
      this.drawChart();
    }
  }

  private async buildSummary(trades: TradeRow[], transfers: TransferRow[], dividends: DividendRow[], options: OptionRow[]): Promise<MetricsSummary> {
    const tickers = Array.from(new Set(trades.map(t => t.Ticker).filter(Boolean)));
    const latestPrices = await this.data.fetchPricesBatch(tickers);
    const aggregated = this.data.aggregateTradesFifoByTicker(trades);
    const currentValue = Object.entries(aggregated).reduce((acc, [ticker, info]: any) => {
      const price = latestPrices[ticker] || 0;
      return acc + (info.currentQty || 0) * price;
    }, 0);
    const transfersNet = transfers
      .filter(t => (t as any).origin ? (t as any).origin === 'externo' : true)
      .reduce((acc, t) => acc + (Number(t.Amount) || 0), 0);
    const dividendsSum = dividends.reduce((acc, d) => acc + (Number(d.Amount) || 0), 0);
    const optionsPnl = options.reduce((acc, o) => {
      const net = (o.side === 'SELL' ? +o.premiumGross : -o.premiumGross) + (o.commission || 0);
      return acc + net;
    }, 0);
    const summary = computeSummary(currentValue, transfersNet, dividendsSum, optionsPnl);
    return { ...summary, transfers: transfersNet, dividends: dividendsSum, optionsPnl };
  }

  private drawChart() {
    const points = this.filteredSeries();
    const ctxEl = document.getElementById('dashboardChart') as HTMLCanvasElement | null;
    if (!ctxEl) return;
    const ctx = ctxEl.getContext('2d');
    if (!ctx) return;
    if (this.chart) this.chart.destroy();
    // Asegurar ancho completo antes de instanciar Chart.js
    ctxEl.height = 320;
    ctxEl.width = ctxEl.parentElement ? ctxEl.parentElement.clientWidth : ctxEl.width;
    const labels = points.map(p => p.date.toISOString().slice(0, 10));
    const base = this.data.baseCurrency();
    const datasets: any[] = [
      {
        label: `Valor portafolio (${base})`,
        data: points.map(p => p.value),
        borderColor: 'rgba(99, 102, 241, 1)',
        backgroundColor: 'rgba(99, 102, 241, 0.2)',
        tension: 0.2,
        yAxisID: 'y'
      }
    ];
    if (this.showTransfers()) {
      datasets.push({
        label: 'Aportes/retiros',
        data: points.map(p => p.transfers),
        borderColor: 'rgba(16, 185, 129, 1)',
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
        tension: 0.2,
        yAxisID: 'y'
      });
    }
    if (this.showPnlPct()) {
      datasets.push({
        label: 'Beneficio %',
        data: points.map(p => p.pnlPct),
        borderColor: 'rgba(244, 114, 182, 1)',
        backgroundColor: 'rgba(244, 114, 182, 0.2)',
        tension: 0.2,
        yAxisID: 'y1'
      });
    }
    this.chart = new (window as any).Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { beginAtZero: true, position: 'left' },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } }
        }
      }
    });
  }
}
