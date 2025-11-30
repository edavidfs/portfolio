import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-content-layout',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './content-layout.component.html',
  host: { class: 'flex-1 min-h-0 w-full h-full flex flex-col' }
})
export class ContentLayoutComponent {}
