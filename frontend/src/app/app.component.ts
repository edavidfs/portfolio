import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from './services/data.service';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { CashViewComponent } from './components/cash-view/cash-view.component';
import { PositionsViewComponent } from './components/positions-view/positions-view.component';
import { TransfersViewComponent } from './components/transfers-view/transfers-view.component';
import { DividendsViewComponent } from './components/dividends-view/dividends-view.component';
import { ImportsViewComponent } from './components/imports-view/imports-view.component';
import { ToastsComponent } from './components/toasts/toasts.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, CashViewComponent, PositionsViewComponent, TransfersViewComponent, DividendsViewComponent, ImportsViewComponent, ToastsComponent, RouterOutlet],
  templateUrl: './app.component.html'
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
  closeDetail(){
    if (this.router.url.startsWith('/ticker/')) {
      this.router.navigateByUrl('/');
    }
  }
}
