import { Component, HostListener, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-tooltip-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button type="button"
            class="absolute top-2 right-2 w-5 h-5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center text-xs shadow-sm hover:bg-blue-200 hover:text-blue-800 focus:outline-none"
            [attr.aria-expanded]="open() ? 'true' : 'false'"
            (click)="toggle($event)"
            (mouseenter)="open.set(true)"
            (mouseleave)="open.set(false)"
            title="Más información">
      ?
    </button>
    <div *ngIf="open()"
         class="absolute z-50 mt-2 right-2 top-6 w-64 bg-white text-gray-800 border rounded-md shadow-lg p-2 text-xs"
         (mouseenter)="open.set(true)"
         (mouseleave)="open.set(false)">
      <div class="leading-snug">{{ text }}</div>
    </div>
  `
})
export class TooltipIconComponent {
  @Input() text = '';
  open = signal(false);

  toggle(event: Event){
    event.stopPropagation();
    this.open.set(!this.open());
  }

  @HostListener('document:click')
  onDocClick(){ this.open.set(false); }
}
