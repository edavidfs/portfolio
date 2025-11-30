import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-bottombar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bottombar.component.html'
})
export class BottombarComponent {
  @Input() checking = false;
  @Input() error = '';
  @Input() available = false;
  @Input() message = '';
  @Output() retry = new EventEmitter<void>();
}
