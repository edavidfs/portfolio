import { DataService } from './data.service';

class MockToast {
  success() {}
  warning() {}
  error() {}
  info() {}
}

describe('DataService.getPortfolioValueSeries', () => {
  // Cobertura: REQ-UI-0017, REQ-BK-0006 (serie agrupada por intervalo)
  let service: DataService;
  const toast = new MockToast() as any;

  beforeEach(() => {
    service = new DataService(toast);
    (globalThis as any).fetch = undefined;
  });

  it('mapea la respuesta del backend a objetos con fecha', async () => {
    const mockResponse = {
      base_currency: 'USD',
      interval: 'month',
      series: [
        { date: '2024-01-31', value_base: 1500, transfers_base: 1000, pnl_pct: 150 }
      ]
    };
    const fetchSpy = jasmine.createSpy('fetch').and.returnValue(Promise.resolve({
      ok: true,
      json: async () => mockResponse
    }));
    (globalThis as any).fetch = fetchSpy;

    const result = await service.getPortfolioValueSeries('month', 'eur');
    expect(result.length).toBe(1);
    expect(result[0].date instanceof Date).toBeTrue();
    expect(result[0].value).toBeCloseTo(1500);
    expect(result[0].transfers).toBeCloseTo(1000);
    const url = fetchSpy.calls.mostRecent().args[0] as string;
    expect(url).toContain('/portfolio/value/series?interval=month');
    expect(url).toContain('base=EUR');
  });

  it('lanza error si el backend responde con fallo', async () => {
    const fetchSpy = jasmine.createSpy('fetch').and.returnValue(Promise.resolve({
      ok: false,
      text: async () => 'fail'
    }));
    (globalThis as any).fetch = fetchSpy;
    await expectAsync(service.getPortfolioValueSeries('day')).toBeRejected();
  });
});

describe('DataService health/init', () => {
  // Cobertura: REQ-UI-0020 (health al iniciar y bloqueo de acciones)
  let service: DataService;
  const toast = new MockToast() as any;

  beforeEach(() => {
    service = new DataService(toast);
  });

  it('marca servicio disponible y carga datos cuando /health responde OK', async () => {
    const fetchSpy = jasmine.createSpy('fetch').and.returnValue(Promise.resolve({ ok: true, json: async () => ({ status: 'ok' }) }));
    (globalThis as any).fetch = fetchSpy;
    const loadSpy = jasmine.createSpy('loadInitialData').and.returnValue(Promise.resolve());
    (service as any).loadInitialData = loadSpy;

    await service.init();

    expect(service.serviceAvailable()).toBeTrue();
    expect(service.serviceChecking()).toBeFalse();
    expect(service.serviceError()).toBe('');
    expect(loadSpy).toHaveBeenCalled();
  });

  it('deja servicio en error si /health falla y permite reintentar', async () => {
    const fetchSpy = jasmine.createSpy('fetch').and.returnValues(
      Promise.resolve({ ok: false, text: async () => 'fallo' }),
      Promise.resolve({ ok: true, json: async () => ({ status: 'ok' }) })
    );
    (globalThis as any).fetch = fetchSpy;
    const loadSpy = jasmine.createSpy('loadInitialData').and.returnValue(Promise.resolve());
    (service as any).loadInitialData = loadSpy;

    await service.init();
    expect(service.serviceAvailable()).toBeFalse();
    expect(service.serviceError()).toContain('fallo');
    expect(loadSpy).not.toHaveBeenCalled();

    await service.init();
    expect(service.serviceAvailable()).toBeTrue();
    expect(service.serviceError()).toBe('');
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });
});
