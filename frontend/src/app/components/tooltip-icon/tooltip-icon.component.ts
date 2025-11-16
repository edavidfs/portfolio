import { Component, HostListener, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-tooltip-icon',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tooltip-icon.component.html'
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
