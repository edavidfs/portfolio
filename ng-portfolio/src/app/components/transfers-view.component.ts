import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';

@Component({
  selector: 'app-transfers-view',
  standalone: true,
  imports: [CommonModule],
  template: `
  <table class="min-w-full divide-y divide-gray-200">
    <thead class="bg-gray-50">
      <tr>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Importe</th>
        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Moneda</th>
      </tr>
    </thead>
    <tbody class="bg-white divide-y divide-gray-200">
      <tr *ngFor="let r of rows">
        <td class="px-3 py-1">{{ r.DateTime | date:'shortDate' }}</td>
        <td class="px-3 py-1">{{ r.Amount | number:'1.2-2' }}</td>
        <td class="px-3 py-1">{{ r.CurrencyPrimary }}</td>
      </tr>
    </tbody>
  </table>
  `
})
export class TransfersViewComponent {
  private data = inject(DataService);
  rows = this.data.transfers().slice().sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
}

