import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-positions-view',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './positions-view.component.html'
})
export class PositionsViewComponent implements OnInit {
  private data = inject(DataService);
  rows = signal<any[]>([]);
  filteredSortedRows = signal<any[]>([]);
  query = signal<string>('');
  showZero = signal<boolean>(true);
  sortKey = signal<string>('ticker');
  sortDir = signal<'asc'|'desc'>('asc');
  private chart: any;

  async ngOnInit(){
    await this.refresh();
  }

  private async refresh(){
    const trades = this.data.trades();
    const aggregated:any = this.data.aggregateTradesFifoByTicker(trades);
    const divStats = this.data.computeDividendStats(this.data.dividends());
    const flows = this.data.computeTradeCashFlowByTicker(trades);
    const premMap = this.data.computeOptionPremiumByUnderlying(this.data.options() as any);
    const optUnderlyings = Array.from(new Set(this.data.options().map(o => o.underlying)));
    const tickers = Array.from(new Set([...(Object.keys(aggregated)), ...optUnderlyings]));
    const prices = await this.data.fetchPricesBatch(tickers);
    const result = tickers.map(t => {
      const a = aggregated[t];
      const current = prices[t] || 0;
      const qty = a ? a.currentQty : 0;
      const currentValue = qty * current;
      const div = (divStats as any)[t] || { total: 0 };
      const flow = (flows as any)[t] || 0;
      const optNet = premMap[t] || 0;
      const baseCost = - (flow + (div.total || 0) + optNet);
      const baseCostPerShare = qty > 0 ? baseCost / qty : 0;
      return { ticker: t, quantity: qty, purchase: a ? a.avgCost : 0, baseCostPerShare, baseCostTotal: baseCost, current, currentValue };
    });
    this.rows.set(result);
    this.applyFilters();
    this.drawChart(this.filteredSortedRows());
  }

  private drawChart(rows:any[]){
    const labels = rows.map(r => r.ticker);
    const values = rows.map(r => r.currentValue);
    const canvas:any = document.getElementById('positionsChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (this.chart) this.chart.destroy();
    this.chart = new (window as any).Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Valor por acción', data: values, backgroundColor: 'rgba(54, 162, 235, 0.5)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }] },
      options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });
  }

  setQuery(v:string){ this.query.set((v||'').toUpperCase()); this.applyFilters(); }
  toggleShowZero(v:boolean){ this.showZero.set(!!v); this.applyFilters(); }
  setSortKey(k:string){ this.sortKey.set(k); this.applyFilters(); }
  toggleSortDir(){ this.sortDir.set(this.sortDir()==='asc'?'desc':'asc'); this.applyFilters(); }

  private applyFilters(){
    const q = this.query();
    const showZero = this.showZero();
    const key = this.sortKey();
    const dir = this.sortDir();
    let out = this.rows().filter(r => (showZero || r.quantity > 0) && (!q || String(r.ticker).toUpperCase().includes(q)));
    out = out.sort((a,b)=>{
      if (key==='ticker') return String(a.ticker).localeCompare(String(b.ticker)) * (dir==='asc'?1:-1);
      const va = Number(a[key]) || 0;
      const vb = Number(b[key]) || 0;
      return (va - vb) * (dir==='asc'?1:-1);
    });
    this.filteredSortedRows.set(out);
  }
}
