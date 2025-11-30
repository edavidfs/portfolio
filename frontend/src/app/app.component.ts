import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from './services/data.service';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { CashViewComponent } from './components/cash-view/cash-view.component';
import { PositionsViewComponent } from './components/positions-view/positions-view.component';
import { TransfersViewComponent } from './components/transfers-view/transfers-view.component';
import { DividendsViewComponent } from './components/dividends-view/dividends-view.component';
import { ImportsViewComponent } from './components/imports-view/imports-view.component';
import { ToastsComponent } from './components/toasts/toasts.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { ConfigViewComponent } from './components/config-view/config-view.component';
import { TopbarComponent } from './components/layout/topbar/topbar.component';
import { SidebarComponent } from './components/layout/sidebar/sidebar.component';
import { BottombarComponent } from './components/layout/bottombar/bottombar.component';
import { ContentLayoutComponent } from './components/layout/content-layout/content-layout.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    CashViewComponent,
    PositionsViewComponent,
    TransfersViewComponent,
    DividendsViewComponent,
    ImportsViewComponent,
    DashboardComponent,
    ConfigViewComponent,
    ToastsComponent,
    TopbarComponent,
    SidebarComponent,
    BottombarComponent,
    ContentLayoutComponent,
    RouterOutlet
  ],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit {
  data = inject(DataService);
  private router = inject(Router);
  view = signal<'dashboard'|'positions'|'cash'|'transfers'|'dividends'|'imports'|'config'>('dashboard');
  isDetail = signal<boolean>(false);
  constructor(){
    this.isDetail.set(this.router.url.startsWith('/ticker/'));
    this.router.events.subscribe(ev => {
      if (ev instanceof NavigationEnd) {
        this.isDetail.set(this.router.url.startsWith('/ticker/'));
      }
    });
  }
  async ngOnInit(): Promise<void> {
    await this.data.init();
  }
  setView(v: 'dashboard'|'positions'|'cash'|'transfers'|'dividends'|'imports'|'config'){ this.view.set(v); }
  closeDetail(){
    if (this.router.url.startsWith('/ticker/')) {
      this.router.navigateByUrl('/');
    }
  }
}
