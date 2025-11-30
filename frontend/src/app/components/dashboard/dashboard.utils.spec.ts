import { computeSummary } from './dashboard.utils';
import { buildCombinedSeries } from './dashboard.utils';

describe('computeSummary', () => {
  // Cobertura: REQ-UI-0011 (cajas métricas de flujos y PnL)
  it('devuelve beneficio 0 cuando solo hay aportes y sin posiciones', () => {
    const res = computeSummary(0, 10000, 0, 0);
    expect(res.benefit).toBeCloseTo(0);
    expect(res.benefitPct).toBeCloseTo(0);
  });

  it('calcula beneficio cuando el valor supera los aportes', () => {
    const res = computeSummary(12000, 10000, 0, 0);
    expect(res.benefit).toBeCloseTo(2000);
    expect(res.benefitPct).toBeCloseTo(20);
  });

  it('incluye dividendos y opciones como flujos positivos', () => {
    const res = computeSummary(0, 10000, 500, 200);
    expect(res.benefit).toBeCloseTo(700);
    expect(res.benefitPct).toBeCloseTo(7);
  });
});

describe('buildCombinedSeries', () => {
  // Cobertura: REQ-UI-0009, REQ-UI-0017 (serie de valor con aportes y agrupación)
  it('genera serie aunque solo haya transferencias', () => {
    const transfers = [
      { date: new Date('2024-01-01'), amount: 1000, origin: 'externo' },
      { date: new Date('2024-02-01'), amount: -200, origin: 'externo' }
    ];
    const series = buildCombinedSeries([], transfers);
    expect(series.length).toBe(2);
    expect(series[0].transfers).toBeCloseTo(1000);
    expect(series[1].transfers).toBeCloseTo(800);
  });

  it('ignora transferencias no externas', () => {
    const transfers = [
      { date: new Date('2024-01-01'), amount: 1000, origin: 'externo' },
      { date: new Date('2024-01-02'), amount: 500, origin: 'fx_interno' }
    ];
    const series = buildCombinedSeries([], transfers);
    expect(series.length).toBe(1);
    expect(series[0].transfers).toBeCloseTo(1000);
  });
});
