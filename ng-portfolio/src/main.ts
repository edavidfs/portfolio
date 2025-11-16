import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, Routes } from '@angular/router';
import { AppComponent } from './app/app.component';

const routes: Routes = [
  { path: 'ticker/:ticker', loadComponent: () => import('./app/components/ticker-detail/ticker-detail.component').then(m => m.TickerDetailComponent) }
];

bootstrapApplication(AppComponent, { providers: [provideRouter(routes)] }).catch(err => console.error(err));
