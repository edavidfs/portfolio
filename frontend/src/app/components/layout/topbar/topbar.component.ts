import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule],
  template: `
  <header class="bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-800 text-white shadow-lg">
    <nav class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center text-lg font-bold">PF</div>
        <div>
          <p class="text-sm uppercase tracking-wide text-indigo-200">Dashboard</p>
          <h1 class="text-xl font-semibold leading-tight">Portfolio</h1>
        </div>
      </div>
    </nav>
  </header>
  `
})
export class TopbarComponent {
  @Input() checking = false;
  @Input() available = false;
}
