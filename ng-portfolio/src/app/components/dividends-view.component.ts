import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';

@Component({
  selector: 'app-dividends-view',
  standalone: true,
  imports: [CommonModule],
  template: `
  <table class="min-w-full divide-y divide-gray-200">
    <thead class="bg-gray-50">
      <tr>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Importe</th>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Moneda</th>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ticker</th>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Impuesto</th>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">País</th>
      </tr>
    </thead>
    <tbody class="bg-white divide-y divide-gray-200">
      <tr *ngFor="let r of rows">
        <td class="px-3 py-1">{{ r.DateTime | date:'shortDate' }}</td>
        <td class="px-3 py-1">{{ r.Amount | number:'1.2-2' }}</td>
        <td class="px-3 py-1">{{ r.CurrencyPrimary }}</td>
        <td class="px-3 py-1">{{ r.Ticker }}</td>
        <td class="px-3 py-1">{{ r.Tax | number:'1.2-2' }}</td>
        <td class="px-3 py-1">{{ r.IssuerCountryCode }}</td>
      </tr>
    </tbody>
  </table>
  <div class="mt-6">
    <h3 class="text-sm font-medium text-gray-700 mb-2">Totales por día</h3>
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Importe</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Moneda</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        <tr *ngFor="let r of daily">
          <td class="px-3 py-1">{{ r.Date | date:'shortDate' }}</td>
          <td class="px-3 py-1">{{ r.Amount | number:'1.2-2' }}</td>
          <td class="px-3 py-1">{{ r.Currency }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  `
})
export class DividendsViewComponent {
  private data = inject(DataService);
  rows = this.data.dividends().slice().sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
  daily = this.aggregateDividendsByDay(this.data.dividends());

  private aggregateDividendsByDay(rows:any[]){
    const map:any = {};
    rows.forEach((r:any)=>{
      const key = r.DateTime.toISOString().slice(0,10) + r.CurrencyPrimary;
      if (!map[key]) map[key] = { Date: r.DateTime, Currency: r.CurrencyPrimary, Amount: 0 };
      map[key].Amount += r.Amount;
    });
    return Object.values(map).sort((a:any,b:any)=> (a.Date as Date).getTime() - (b.Date as Date).getTime());
  }
}

