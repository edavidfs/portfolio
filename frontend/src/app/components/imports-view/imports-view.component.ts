import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-imports-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './imports-view.component.html'
})
export class ImportsViewComponent {
  private data = inject(DataService);
  showResetConfirm = false;
  resettingDb = false;
  onTrades(e:any){ const files:FileList = e.target.files; this.data.importTradesCsv(files); }
  onTransfers(e:any){ const files:FileList = e.target.files; this.data.importTradesCsv(files); try { if (e?.target) e.target.value = ''; } catch {} }
  onDividends(e:any){ const files:FileList = e.target.files; this.data.parseFiles(files, async flat => { await this.data.importDividends(flat); }); }
  async onUpdatePrices(){ await this.data.updateAllPrices(); }
  openResetConfirm(){ this.showResetConfirm = true; }
  closeResetConfirm(){ if (!this.resettingDb) this.showResetConfirm = false; }
  async confirmReset(){
    if (this.resettingDb) return;
    this.resettingDb = true;
    try {
      await this.data.resetBackendDb();
      this.showResetConfirm = false;
    } finally {
      this.resettingDb = false;
    }
  }

}
