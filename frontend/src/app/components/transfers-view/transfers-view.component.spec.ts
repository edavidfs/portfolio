import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TransfersViewComponent } from './transfers-view.component';
import { DataService } from '../../services/data.service';

class MockDataService {
  transfers = signal<any[]>([
    { DateTime: new Date('2024-01-01'), Amount: 100, CurrencyPrimary: 'EUR' }
  ]);
  getTransfersSeries = jasmine.createSpy('getTransfersSeries').and.returnValue(Promise.resolve({
    EUR: [{ date: new Date('2024-01-01'), amount: 100, cumulative: 100 }]
  }));
}

describe('TransfersViewComponent', () => {
  // Cobertura: REQ-BK-0012 (serie temporal de transferencias)
  let fixture: ComponentFixture<TransfersViewComponent>;
  let component: TransfersViewComponent;
  let data: MockDataService;

  beforeEach(async () => {
    (globalThis as any).Chart = function () { return { destroy() {} }; };
    data = new MockDataService();
    await TestBed.configureTestingModule({
      imports: [TransfersViewComponent],
      providers: [{ provide: DataService, useValue: data }]
    }).compileComponents();
  });

  it('usa timestamps numéricos en el dataset de la serie', async () => {
    data.getTransfersSeries.and.returnValue(Promise.resolve({
      EUR: [{ date: new Date('2024-01-01'), amount: 100, cumulative: 100 }]
    }));
    fixture = TestBed.createComponent(TransfersViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const series = component.series();
    expect(series['EUR'][0].date instanceof Date).toBeTrue();
    // Las entradas en el chart se construyen usando getTime()
    const chart = (component as any).chart;
    const dataPoints = chart?.data?.datasets?.[0]?.data || [];
    expect(Array.isArray(dataPoints)).toBeTrue();
    if (dataPoints.length) {
      expect(typeof dataPoints[0].x).toBe('number');
    }
  });

  it('carga transfers y solicita la serie completa al backend al iniciar', async () => {
    fixture = TestBed.createComponent(TransfersViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(data.getTransfersSeries).toHaveBeenCalledWith('day', undefined, jasmine.any(String));
    expect(component.rows().length).toBe(1);
    const series = component.series();
    expect(series['EUR'].length).toBe(1);
    expect(series['EUR'][0].cumulative).toBe(100);
  });
});
