import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { AppComponent } from './app.component';
import { DataService } from './services/data.service';

class MockDataService {
  serviceChecking = signal(false);
  serviceAvailable = signal(false);
  serviceError = signal<string>('');
  baseCurrency = signal('USD');
  trades = signal<any[]>([]);
  transfers = signal<any[]>([]);
  dividends = signal<any[]>([]);
  options = signal<any[]>([]);
  init = jasmine.createSpy('init');
  syncFx = jasmine.createSpy('syncFx').and.returnValue(Promise.resolve());
  getPortfolioValueSeries = jasmine.createSpy('getPortfolioValueSeries').and.returnValue(Promise.resolve([]));
  fetchPricesBatch = jasmine.createSpy('fetchPricesBatch').and.returnValue(Promise.resolve({}));
  aggregateTradesFifoByTicker = jasmine.createSpy('aggregateTradesFifoByTicker').and.returnValue({});
}

// Cobertura: REQ-UI-0020 (health al iniciar y bloqueo de acciones)
describe('AppComponent health check', () => {
  let fixture: ComponentFixture<AppComponent>;
  let component: AppComponent;
  let data: MockDataService;

  beforeEach(async () => {
    data = new MockDataService();
    await TestBed.configureTestingModule({
      imports: [AppComponent, RouterTestingModule],
      providers: [{ provide: DataService, useValue: data }],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();
  });

  it('habilita la UI tras un health OK', async () => {
    data.init.and.callFake(async () => {
      data.serviceChecking.set(true);
      await Promise.resolve();
      data.serviceAvailable.set(true);
      data.serviceError.set('');
      data.serviceChecking.set(false);
    });
    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('aside button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn: HTMLButtonElement) => {
      expect(btn.disabled).toBeFalse();
    });
    expect(data.init).toHaveBeenCalled();
    expect(data.serviceAvailable()).toBeTrue();
  });

  it('bloquea acciones y muestra reintento si el health falla y luego permite al reintentar', async () => {
    let firstCall = true;
    data.init.and.callFake(async () => {
      data.serviceChecking.set(true);
      await Promise.resolve();
      if (firstCall) {
        data.serviceAvailable.set(false);
        data.serviceError.set('caido');
        firstCall = false;
      } else {
        data.serviceError.set('');
        data.serviceAvailable.set(true);
      }
      data.serviceChecking.set(false);
    });
    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const errorBanner = fixture.nativeElement.querySelector('div.bg-red-50');
    expect(errorBanner).toBeTruthy();
    const sidebarButtons = fixture.nativeElement.querySelectorAll('aside button');
    sidebarButtons.forEach((btn: HTMLButtonElement) => expect(btn.disabled).toBeTrue());
    expect(data.init).toHaveBeenCalledTimes(1);

    const retryBtn = fixture.nativeElement.querySelector('button.bg-red-600');
    retryBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sidebarButtonsAfter = fixture.nativeElement.querySelectorAll('aside button');
    sidebarButtonsAfter.forEach((btn: HTMLButtonElement) => expect(btn.disabled).toBeFalse());
    expect(data.init).toHaveBeenCalledTimes(2);
    expect(data.serviceAvailable()).toBeTrue();
  });
});
