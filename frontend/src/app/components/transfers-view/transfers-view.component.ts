import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService, TransferRow } from '../../services/data.service';

declare const Chart: any;

@Component({
  selector: 'app-transfers-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transfers-view.component.html'
})
export class TransfersViewComponent implements OnInit, OnDestroy {
  private data = inject(DataService);
  rows = signal<TransferRow[]>([]);
  series = signal<Record<string, { date: Date; cumulative: number; amount: number }[]>>({});
  private chart: any;

  async ngOnInit(): Promise<void> {
    this.refreshRows();
    await this.loadSeries();
    this.buildChart();
  }

  ngOnDestroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  private refreshRows() {
    const sorted = this.data.transfers().slice().sort((a, b) => a.DateTime.getTime() - b.DateTime.getTime());
    this.rows.set(sorted);
  }

  private async loadSeries() {
    const today = new Date();
    const res = await this.data.getTransfersSeries('day', undefined, today.toISOString().slice(0, 10));
    this.series.set(res);
  }

  private buildChart() {
    const canvas = document.getElementById('transfersChart') as HTMLCanvasElement | null;
    const seriesMap = this.series();
    if (!canvas || !Object.keys(seriesMap).length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (this.chart) this.chart.destroy();

    const colors = ['#6366f1', '#22c55e', '#f97316', '#0ea5e9', '#a855f7', '#f59e0b', '#ef4444'];
    const datasets = Object.entries(seriesMap).map(([currency, points], idx) => ({
      label: currency,
      data: points.map(p => ({ x: p.date.getTime(), y: p.cumulative })),
      borderColor: colors[idx % colors.length],
      backgroundColor: colors[idx % colors.length],
      tension: 0.2
    }));

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        scales: {
          x: {
            type: 'time',
            time: { unit: 'day' },
            ticks: { maxRotation: 0 }
          },
          y: {
            beginAtZero: false,
            ticks: { callback: (val: any) => Number(val).toLocaleString() }
          }
        },
        plugins: {
          legend: { display: true, position: 'top' },
          tooltip: {
            callbacks: {
              label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.y?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            }
          }
        }
      }
    });
  }
}
