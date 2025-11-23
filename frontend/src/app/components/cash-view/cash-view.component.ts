import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService, TransferRow, DividendRow } from '../../services/data.service';

@Component({
  selector: 'app-cash-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cash-view.component.html'
})
export class CashViewComponent implements OnInit {
  private data = inject(DataService);
  rows: TransferRow[] = [];
  private chart: any;
  private premChart: any;
  private yearBoundaryPlugin = this.buildYearBoundaryPlugin();

  ngOnInit(){
    this.refresh();
  }

  private refresh(){
    const trs = this.data.transfers();
    this.rows = trs.filter(r => this.getType(r) !== 'STK').sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
    const all = [...this.data.transfers(), ...this.data.dividends()];
    this.drawCashChart(all);
    this.drawPremiumChart(trs);
  }

  getType(row:TransferRow){
    const id = String((row as any).TransactionID || '');
    if (id.startsWith('FX:')) return 'FX';
    if (id.startsWith('OPT:')) return 'OPT';
    if (id.startsWith('STK:')) return 'STK';
    if (id.startsWith('CASH:')) return 'CASH';
    return 'Transferencia';
  }

  private computeCashHistory(rows:(TransferRow|DividendRow)[]){
    const sorted = [...rows].sort((a:any, b:any) => (a.DateTime as Date).getTime() - (b.DateTime as Date).getTime());
    const histories: Record<string, {x:Date,y:number}[]> = {};
    sorted.forEach((r:any) => {
      const currency = r.CurrencyPrimary || r.currency;
      const date = r.DateTime;
      const amount = Number(r.Amount) || 0;
      if (!histories[currency]) histories[currency] = [];
      const last = histories[currency].length ? histories[currency][histories[currency].length - 1].y : 0;
      histories[currency].push({ x: date, y: last + amount });
    });
    return histories;
  }

  private drawCashChart(rows:(TransferRow|DividendRow)[]){
    const histories = this.computeCashHistory(rows);
    const colors = ['rgba(75, 192, 192, 1)','rgba(54, 162, 235, 1)','rgba(255, 99, 132, 1)','rgba(255, 206, 86, 1)'];
    const datasets = Object.keys(histories).map((currency, i) => ({ label: currency, data: histories[currency], borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length], fill: false }));
    if (!datasets.length) return;
    const canvas:any = document.getElementById('cashChart'); if (!canvas) return; const ctx = canvas.getContext('2d');
    if (this.chart) this.chart.destroy();
    this.chart = new (window as any).Chart(ctx, { type: 'line', data: { datasets }, options: { responsive: true, scales: { x: { type: 'time', time: { unit: 'day' } }, y: { beginAtZero: true } } }, plugins: [this.yearBoundaryPlugin] });
  }

  private drawPremiumChart(rows:TransferRow[]){
    const opts = rows.filter(r => this.getType(r) === 'OPT').sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
    const received: {x:Date,y:number}[] = [];
    const paid: {x:Date,y:number}[] = [];
    let accRec = 0;
    let accPaid = 0;
    opts.forEach(r => {
      const amt = Number(r.Amount) || 0;
      if (amt >= 0) { accRec += amt; received.push({ x: r.DateTime, y: accRec }); paid.push({ x: r.DateTime, y: accPaid }); }
      else { accPaid += -amt; paid.push({ x: r.DateTime, y: accPaid }); received.push({ x: r.DateTime, y: accRec }); }
    });
    const canvas:any = document.getElementById('optionsPremiumChart'); if (!canvas) return; const ctx = canvas.getContext('2d');
    if (this.premChart) this.premChart.destroy();
    if (!opts.length) { this.premChart = null; return; }
    this.premChart = new (window as any).Chart(ctx, {
      type: 'line',
      data: { datasets: [
        { label: 'Cobradas (acum.)', data: received, borderColor: 'rgba(34,197,94,1)', backgroundColor: 'rgba(34,197,94,0.3)', fill: false },
        { label: 'Pagadas (acum.)', data: paid, borderColor: 'rgba(239,68,68,1)', backgroundColor: 'rgba(239,68,68,0.3)', fill: false }
      ]},
      options: { responsive: true, scales: { x: { type: 'time', time: { unit: 'day' } }, y: { beginAtZero: true } } },
      plugins: [this.yearBoundaryPlugin]
    });
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
        const ctx = chart.ctx;
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
}
