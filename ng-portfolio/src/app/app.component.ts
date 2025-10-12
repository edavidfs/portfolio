import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from './services/data.service';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { CashViewComponent } from './components/cash-view.component';
import { PositionsViewComponent } from './components/positions-view.component';
import { TransfersViewComponent } from './components/transfers-view.component';
import { DividendsViewComponent } from './components/dividends-view.component';
import { ImportsViewComponent } from './components/imports-view.component';
import { ToastsComponent } from './components/toasts.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, CashViewComponent, PositionsViewComponent, TransfersViewComponent, DividendsViewComponent, ImportsViewComponent, ToastsComponent, RouterOutlet],
  template: `
    <nav class="bg-gray-800 text-white p-4">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Portfolio (Angular)</h1>
        <button class="inline-flex items-center px-3 py-1.5 border border-red-300 text-sm font-medium rounded-md text-red-100 bg-transparent hover:bg-red-700/30" (click)="onReset()" title="Borrar datos locales">Reset</button>
      </div>
    </nav>
    <app-toasts></app-toasts>
    <div class="flex min-h-screen">
      <aside class="w-64 bg-white border-r p-4 space-y-2">
        <button class="w-full text-left px-3 py-2 rounded hover:bg-gray-100" [class.bg-indigo-50]="view() === 'positions'" (click)="setView('positions')">Posiciones</button>
        <button class="w-full text-left px-3 py-2 rounded hover:bg-gray-100" [class.bg-indigo-50]="view() === 'cash'" (click)="setView('cash')">Efectivo</button>
        <button class="w-full text-left px-3 py-2 rounded hover:bg-gray-100" [class.bg-indigo-50]="view() === 'transfers'" (click)="setView('transfers')">Transferencias</button>
        <button class="w-full text-left px-3 py-2 rounded hover:bg-gray-100" [class.bg-indigo-50]="view() === 'dividends'" (click)="setView('dividends')">Dividendos</button>
        <div class="pt-4 border-t"></div>
        <button class="w-full text-left px-3 py-2 rounded hover:bg-gray-100" [class.bg-indigo-50]="view() === 'imports'" (click)="setView('imports')">Importaciones</button>
      </aside>
      <main class="flex-1 p-6 space-y-8">
        <ng-container *ngIf="!isDetail(); else detail">
          <app-positions-view *ngIf="view() === 'positions'"></app-positions-view>
          <app-cash-view *ngIf="view() === 'cash'"></app-cash-view>
          <app-transfers-view *ngIf="view() === 'transfers'"></app-transfers-view>
          <app-dividends-view *ngIf="view() === 'dividends'"></app-dividends-view>
          <app-imports-view *ngIf="view() === 'imports'"></app-imports-view>
        </ng-container>
        <ng-template #detail>
          <router-outlet></router-outlet>
        </ng-template>
      </main>
    </div>
  `
})
export class AppComponent {
  private data = inject(DataService);
  private router = inject(Router);
  view = signal<'positions'|'cash'|'transfers'|'dividends'|'imports'>('positions');
  isDetail = signal<boolean>(false);
  constructor(){
    this.data.init();
    this.router.events.subscribe(ev => {
      if (ev instanceof NavigationEnd) {
        this.isDetail.set(this.router.url.startsWith('/ticker/'));
      }
    });
  }
  setView(v: 'positions'|'cash'|'transfers'|'dividends'|'imports'){ this.view.set(v); }
  onReset(){
    const ok = confirm('Esto borrará todos los datos locales. ¿Continuar?');
    if (!ok) return;
    this.data.reset();
  }
}
