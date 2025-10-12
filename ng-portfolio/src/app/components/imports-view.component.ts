import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';

@Component({
  selector: 'app-imports-view',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="space-y-4">
    <div>
      <label class="block text-sm font-medium mb-1">Operaciones (STK + CASH/FX)</label>
      <input type="file" multiple (change)="onTrades($event)" class="block" />
    </div>
    <div>
      <label class="block text-sm font-medium mb-1">Transferencias</label>
      <input type="file" multiple (change)="onTransfers($event)" class="block" />
    </div>
    <div>
      <label class="block text-sm font-medium mb-1">Dividendos</label>
      <input type="file" multiple (change)="onDividends($event)" class="block" />
    </div>
  </div>
  `
})
export class ImportsViewComponent {
  private data = inject(DataService);
  onTrades(e:any){ const files:FileList = e.target.files; this.data.parseFiles(files, async flat => { await this.data.importTradesAndCash(flat); }); }
  onTransfers(e:any){ const files:FileList = e.target.files; this.data.parseFiles(files, async flat => { await this.data.importTransfers(flat); }); }
  onDividends(e:any){ const files:FileList = e.target.files; this.data.parseFiles(files, async flat => { await this.data.importDividends(flat); }); }
}

