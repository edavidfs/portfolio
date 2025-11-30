import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

type ViewId = 'dashboard'|'positions'|'cash'|'transfers'|'dividends'|'imports'|'config';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.component.html',
  host: { class: 'h-full block' }
})
export class SidebarComponent {
  @Input() view: ViewId = 'dashboard';
  @Input() checking = false;
  @Input() available = false;
  @Input() syncingFx = false;
  @Output() viewChange = new EventEmitter<ViewId>();
  @Output() syncFxClick = new EventEmitter<void>();

  onViewChange(view: ViewId) {
    this.viewChange.emit(view);
  }

  onSyncFx() {
    this.syncFxClick.emit();
  }
}
