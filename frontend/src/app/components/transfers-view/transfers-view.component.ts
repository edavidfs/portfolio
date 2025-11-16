import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-transfers-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transfers-view.component.html'
})
export class TransfersViewComponent {
  private data = inject(DataService);
  rows = this.data.transfers().slice().sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
}
