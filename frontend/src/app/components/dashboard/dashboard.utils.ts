export interface SummaryResult {
  benefit: number;
  benefitPct: number;
  interestPaid: number;
}

export interface ValuePoint { date: Date; value: number; }
export interface TransferPoint { date: Date; amount: number; origin?: string; }
export interface SeriesPoint { date: Date; value: number; transfers: number; pnlPct: number; }

/**
 * Calcula beneficio y beneficio % usando aportes/retiros netos como base de capital.
 * Las primas de opciones y dividendos se consideran flujos de ingreso.
 */
export function computeSummary(
  currentValue: number,
  transfersNet: number,
  dividendsSum: number,
  optionsPnl: number
): SummaryResult {
  // Considerar la caja como las transferencias netas externas (aportadas) para no penalizar beneficio cuando solo hay depósitos.
  const cash = transfersNet;
  const base = Math.max(0, transfersNet);
  const equity = currentValue + cash + dividendsSum + optionsPnl;
  const benefit = equity - base;
  const benefitPct = base > 0 ? (benefit / base) * 100 : 0;
  return { benefit, benefitPct, interestPaid: 0 };
}

/**
 * Combina valores de cartera y transferencias externas en una serie temporal.
 * Si no hay precios, aún se genera serie con las fechas de transferencias.
 */
export function buildCombinedSeries(values: ValuePoint[], transfers: TransferPoint[]): SeriesPoint[] {
  const externalTransfers = (transfers || []).filter(t => (t.origin || 'externo') === 'externo');
  const transfersSorted = externalTransfers.slice().sort((a, b) => a.date.getTime() - b.date.getTime());
  const valueSorted = (values || []).slice().sort((a, b) => a.date.getTime() - b.date.getTime());

  let transferAcc = 0;
  const transferByDate = new Map<string, number>();
  transfersSorted.forEach(t => {
    transferAcc += Number(t.amount) || 0;
    const key = t.date.toISOString().slice(0, 10);
    transferByDate.set(key, transferAcc);
  });

  const valueByDate = new Map<string, number>();
  valueSorted.forEach(v => {
    valueByDate.set(v.date.toISOString().slice(0, 10), v.value);
  });

  const allDates = new Set<string>([
    ...Array.from(valueByDate.keys()),
    ...Array.from(transferByDate.keys())
  ]);
  const sortedKeys = Array.from(allDates).sort();
  const out: SeriesPoint[] = [];
  let lastValue = 0;
  let lastTransfer = 0;
  sortedKeys.forEach(key => {
    const d = new Date(key + 'T00:00:00Z');
    if (valueByDate.has(key)) {
      lastValue = valueByDate.get(key) || 0;
    }
    if (transferByDate.has(key)) {
      lastTransfer = transferByDate.get(key) || 0;
    }
    const base = Math.max(0, lastTransfer);
    const pnlPct = base > 0 ? ((lastValue + lastTransfer) / base) * 100 : 0;
    out.push({ date: d, value: lastValue, transfers: lastTransfer, pnlPct });
  });
  return out;
}
