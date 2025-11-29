import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, OnInit, inject, signal } from '@angular/core';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-config-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './config-view.component.html'
})
export class ConfigViewComponent implements OnInit {
  private data = inject(DataService);
  baseCurrency = signal<string>('USD');
  saving = signal<boolean>(false);
  message = signal<string>('');

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load() {
    try {
      const cfg = await this.data.loadConfig();
      this.baseCurrency.set(cfg.baseCurrency);
    } catch (error) {
      this.message.set('No se pudo cargar la configuración.');
      console.error(error);
    }
  }

  async save() {
    const cur = (this.baseCurrency() || '').toUpperCase().trim();
    if (!cur || cur.length < 3) {
      this.message.set('Moneda inválida.');
      return;
    }
    this.saving.set(true);
    this.message.set('');
    try {
      await this.data.updateBaseCurrency(cur);
      this.message.set('Moneda base guardada.');
    } catch (error) {
      console.error(error);
      this.message.set('No se pudo guardar la moneda base.');
    } finally {
      this.saving.set(false);
    }
  }
}
