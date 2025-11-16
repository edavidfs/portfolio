import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-dividends-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dividends-view.component.html'
})
export class DividendsViewComponent {
  private data = inject(DataService);
  rows = this.data.dividends().slice().sort((a,b)=> a.DateTime.getTime() - b.DateTime.getTime());
  daily = this.aggregateDividendsByDay(this.data.dividends());

  private aggregateDividendsByDay(rows:any[]){
    const map:any = {};
    rows.forEach((r:any)=>{
      const key = r.DateTime.toISOString().slice(0,10) + r.CurrencyPrimary;
      if (!map[key]) map[key] = { Date: r.DateTime, Currency: r.CurrencyPrimary, Amount: 0 };
      map[key].Amount += r.Amount;
    });
    return Object.values(map).sort((a:any,b:any)=> (a.Date as Date).getTime() - (b.Date as Date).getTime());
  }
}
