// logic.js - main application logic using persistence layer
const tradesInput = document.getElementById('tradesInput');
const transfersInput = document.getElementById('transfersInput');
const dividendsInput = document.getElementById('dividendsInput');
const optionsInput = document.getElementById('optionsInput');
const importSelectedBtn = document.getElementById('importSelectedBtn');
const autoImportOnSelect = false;
const positionsBody = document.querySelector('#positionsTable tbody');
const transfersBody = document.querySelector('#transfersTable tbody');
const dividendsBody = document.querySelector('#dividendsTable tbody');
const dividendsDailyBody = document.querySelector('#dividendsDailyTable tbody');
const dividendsAssetBody = document.querySelector('#dividendsAssetTable tbody');
const cashOpsBody = document.querySelector('#cashOpsTable tbody');
// Sidebar buttons y vistas
const btnPositions = document.getElementById('btn-positions');
const btnCash = document.getElementById('btn-cash');
const btnTransfers = document.getElementById('btn-transfers');
const btnDividends = document.getElementById('btn-dividends');
const btnImports = document.getElementById('btn-imports');
const navButtons = document.querySelectorAll('.nav-btn');
const sidebar = document.getElementById('sidebar');
const sidebarResizer = document.getElementById('sidebar-resizer');
const sidebarToggle = document.getElementById('btn-toggle-sidebar');
const views = {
  positions: document.getElementById('view-positions'),
  cash: document.getElementById('view-cash'),
  transfers: document.getElementById('view-transfers'),
  dividends: document.getElementById('view-dividends'),
  imports: document.getElementById('view-imports')
};
let positionsChart;
let cashChart;
let trades = [];
let tradeKeys = new Set();
let tradeIds = new Set();
let transfers = [];
let transferIds = new Set();
let dividends = [];
let dividendIds = new Set();
let optionsData = [];
let priceErrorShown = new Set();
let positionsRows = [];
let sortState = { key: 'weightPct', dir: 'desc' };

async function initApp() {
  const db = window.db;
  console.log("Iniciando aplicación");
  await db.initDb();
  console.log("Base de datos inicializada");
  trades = await db.getTrades();
  tradeKeys = new Set(trades.map(t => `${t.Ticker}|${t.Quantity}|${t.PurchasePrice}`));
  tradeIds = new Set(trades.map(t => t.TradeID).filter(Boolean));
  transfers = await db.getTransfers();
  dividends = await db.getDividends();
  transferIds = new Set(transfers.map(t => String(t.TransactionID)));
  dividendIds = new Set(dividends.map(d => String(d.ActionID)));

  // Navegación por sidebar
  function showView(key) {
    Object.values(views).forEach(v => v && v.classList.add('hidden'));
    if (views[key]) views[key].classList.remove('hidden');
    [btnPositions, btnCash, btnTransfers, btnDividends, btnImports].forEach(b => {
      if (!b) return;
      b.classList.remove('bg-indigo-50','text-indigo-700');
    });
    const map = { positions: btnPositions, cash: btnCash, transfers: btnTransfers, dividends: btnDividends, imports: btnImports };
    const active = map[key];
    if (active) active.classList.add('bg-indigo-50','text-indigo-700');
  }
  if (btnPositions) btnPositions.addEventListener('click', () => showView('positions'));
  if (btnCash) btnCash.addEventListener('click', () => showView('cash'));
  if (btnTransfers) btnTransfers.addEventListener('click', () => showView('transfers'));
  if (btnDividends) btnDividends.addEventListener('click', () => showView('dividends'));
  if (btnImports) btnImports.addEventListener('click', () => showView('imports'));
  // Sort handlers para la tabla de posiciones
  document.querySelectorAll('#positionsTable thead .sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-sort');
      if (!key) return;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.dir = key === 'ticker' ? 'asc' : 'desc';
      }
      populateTable(getSortedRows(positionsRows));
    });
  });

  // Estado sidebar (tamaño y colapso)
  let collapsed = false;
  let width = 256; // default
  try {
    collapsed = localStorage.getItem('sidebarCollapsed') === '1';
    const saved = parseInt(localStorage.getItem('sidebarWidth') || '256', 10);
    if (!isNaN(saved)) width = saved;
  } catch(_) {}

  function applySidebarState() {
    if (!sidebar) return;
    const w = collapsed ? 56 : Math.max(180, Math.min(width, 420));
    sidebar.style.width = w + 'px';
    navButtons.forEach(btn => {
      const label = btn.querySelector('.label');
      if (label) label.classList.toggle('hidden', collapsed);
      btn.classList.toggle('justify-center', collapsed);
    });
  }

  applySidebarState();

  // Toggle collapse/expand
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      collapsed = !collapsed;
      try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch(_) {}
      applySidebarState();
    });
  }

  // Drag to resize when not collapsed
  if (sidebarResizer && sidebar) {
    let dragging = false;
    sidebarResizer.addEventListener('mousedown', e => {
      if (collapsed) return;
      dragging = true;
      document.body.classList.add('select-none');
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const left = sidebar.getBoundingClientRect().left;
      width = e.clientX - left;
      applySidebarState();
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('select-none');
      try { localStorage.setItem('sidebarWidth', String(width)); } catch(_) {}
    });
  }

  tradesInput.addEventListener('change', event => {
    if (!autoImportOnSelect) return;
    handleCsv(event, async data => {
      const { stocks, cash } = sanitizeOperations(data);

    // STOCKS: deduplicación por IBExecID si existe, si no por (ticker|qty|price)
    const seenIds = new Set();
    const seenKeys = new Set();
    const stockRows = stocks.filter(r => {
      const id = r.TradeID;
      if (id) {
        if (seenIds.has(id) || tradeIds.has(id)) return false;
        seenIds.add(id);
        return true;
      }
      const key = `${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`;
      if (seenKeys.has(key) || tradeKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    // CASH: deduplicación por TransactionID si existe de IBExecID + fecha
    const seenCash = new Set();
    const cashRows = cash.filter(r => {
      const key = String(r.TransactionID);
      if (!key) return false;
      if (seenCash.has(key) || transferIds.has(key)) return false;
      seenCash.add(key);
      return true;
    });

    const dupStocks = stocks.length - stockRows.length;
    const dupCash = cash.length - cashRows.length;

    stockRows.forEach(r => {
      if (r.TradeID) tradeIds.add(r.TradeID);
      tradeKeys.add(`${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`);
    });
    trades.push(...stockRows);
    if (stockRows.length) await db.addTrades(stockRows);

    // Derivar flujos de efectivo de STK (compras/ventas) como transferencias
    const stockCashDerived = stockTradesToCashRows(stockRows);
    const seenStockCash = new Set();
    const stockCashRows = stockCashDerived.filter(r => {
      const key = String(r.TransactionID);
      if (!key) return false;
      if (seenStockCash.has(key) || transferIds.has(key)) return false;
      seenStockCash.add(key);
      return true;
    });

    cashRows.forEach(r => transferIds.add(String(r.TransactionID)));
    transfers.push(...cashRows);
    if (cashRows.length) await db.addTransfers(cashRows);

    stockCashRows.forEach(r => transferIds.add(String(r.TransactionID)));
    transfers.push(...stockCashRows);
    if (stockCashRows.length) await db.addTransfers(stockCashRows);

    populateTransfersTable(transfers);
    updateCashChart();
    loadPositions();

    if (!stocks.length && !cash.length) {
      showToast('No se han encontrado operaciones válidas.', 'warning');
    } else {
      showToast(`Importadas STK: ${stockRows.length} (ign: ${dupStocks}) | CASH: ${cashRows.length} (ign: ${dupCash}) | CASH de STK: ${stockCashRows.length}.`, 'success');
    }
    });
  });

  transfersInput.addEventListener('change', event => {
    if (!autoImportOnSelect) return;
    handleCsv(event, async data => {
      const input = sanitizeTransfers(data);
      const seen = new Set();
      const rows = input.filter(r => {
        const key = String(r.TransactionID);
        if (!key) return false;
        if (seen.has(key) || transferIds.has(key)) return false;
        seen.add(key);
        return true;
      });
      const dupCount = input.length - rows.length;
      rows.forEach(r => transferIds.add(String(r.TransactionID)));
      transfers.push(...rows);
      if (rows.length) await db.addTransfers(rows);
      populateTransfersTable(transfers);
      updateCashChart();
      if (!input.length) {
        showToast('No se han encontrado transferencias válidas.', 'warning');
      } else {
        showToast(`Transferencias importadas: ${rows.length}. Transacciones ignoradas: ${dupCount}.`, rows.length ? 'success' : 'info');
      }
    });
  });

  dividendsInput.addEventListener('change', event => {
    if (!autoImportOnSelect) return;
    handleCsv(event, async data => {
      const input = sanitizeDividends(data);
      const seen = new Set();
      const rows = input.filter(r => {
        const key = String(r.ActionID);
        if (!key) return false;
        if (seen.has(key) || dividendIds.has(key)) return false;
        seen.add(key);
        return true;
      });
      const dupCount = input.length - rows.length;
      rows.forEach(r => dividendIds.add(String(r.ActionID)));
      dividends.push(...rows);
      if (rows.length) await db.addDividends(rows);
      const daily = aggregateDividendsByDay(dividends);
      const byAsset = summarizeDividendsByAsset(dividends);
      populateDividendsTable(dividends);
      populateDividendsDailyTable(daily);
      populateDividendsAssetTable(byAsset);
      updateCashChart();
      if (!input.length) {
        showToast('No se han encontrado dividendos válidos.', 'warning');
      } else {
        showToast(`Dividendos importados: ${rows.length}. Dividendos ignorados: ${dupCount}.`, rows.length ? 'success' : 'info');
      }
    });
  });

  optionsInput.addEventListener('change', event => {
    if (!autoImportOnSelect) return;
    handleCsv(event, data => { optionsData = data; });
  });

  if (importSelectedBtn) {
    importSelectedBtn.addEventListener('click', async () => {
      const db = window.db;
      let any = false;

      // TRADES (STK + CASH derivado)
      if (tradesInput && tradesInput.files && tradesInput.files.length) {
        any = true;
        await parseFiles(tradesInput.files, async data => {
          const { stocks, cash } = sanitizeOperations(data);
          const seenIds = new Set();
          const seenKeys = new Set();
          const stockRows = stocks.filter(r => {
            const id = r.TradeID;
            if (id) {
              if (seenIds.has(id) || tradeIds.has(id)) return false;
              seenIds.add(id);
              return true;
            }
            const key = `${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`;
            if (seenKeys.has(key) || tradeKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
          });
          const seenCash = new Set();
          const cashRows = cash.filter(r => {
            const key = String(r.TransactionID);
            if (!key) return false;
            if (seenCash.has(key) || transferIds.has(key)) return false;
            seenCash.add(key);
            return true;
          });
          const dupStocks = stocks.length - stockRows.length;
          const dupCash = cash.length - cashRows.length;

          stockRows.forEach(r => {
            if (r.TradeID) tradeIds.add(r.TradeID);
            tradeKeys.add(`${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`);
          });
          trades.push(...stockRows);
          if (stockRows.length) await db.addTrades(stockRows);

          const stockCashRows = stockTradesToCashRows(stockRows).filter(r => {
            const key = String(r.TransactionID);
            if (!key) return false;
            if (transferIds.has(key)) return false;
            return true;
          });
          stockCashRows.forEach(r => transferIds.add(String(r.TransactionID)));
          transfers.push(...stockCashRows);
          if (stockCashRows.length) await db.addTransfers(stockCashRows);

          cashRows.forEach(r => transferIds.add(String(r.TransactionID)));
          transfers.push(...cashRows);
          if (cashRows.length) await db.addTransfers(cashRows);

          populateTransfersTable(transfers);
          updateCashChart();
          loadPositions();

          showToast(`STK: ${stockRows.length} (ign: ${dupStocks}) | CASH: ${cashRows.length} (ign: ${dupCash}) | CASH de STK: ${stockCashRows.length}.`, 'success');
        });
      }

      // TRANSFERS
      if (transfersInput && transfersInput.files && transfersInput.files.length) {
        any = true;
        await parseFiles(transfersInput.files, async data => {
          const input = sanitizeTransfers(data);
          const seen = new Set();
          const rows = input.filter(r => {
            const key = String(r.TransactionID);
            if (!key) return false;
            if (seen.has(key) || transferIds.has(key)) return false;
            seen.add(key);
            return true;
          });
          const dupCount = input.length - rows.length;
          rows.forEach(r => transferIds.add(String(r.TransactionID)));
          transfers.push(...rows);
          if (rows.length) await db.addTransfers(rows);
          populateTransfersTable(transfers);
          updateCashChart();
          showToast(`Transferencias importadas: ${rows.length} (ign: ${dupCount}).`, rows.length ? 'success' : 'info');
        });
      }

      // DIVIDENDS
      if (dividendsInput && dividendsInput.files && dividendsInput.files.length) {
        any = true;
        await parseFiles(dividendsInput.files, async data => {
          const input = sanitizeDividends(data);
          const seen = new Set();
          const rows = input.filter(r => {
            const key = String(r.ActionID);
            if (!key) return false;
            if (seen.has(key) || dividendIds.has(key)) return false;
            seen.add(key);
            return true;
          });
          const dupCount = input.length - rows.length;
          rows.forEach(r => dividendIds.add(String(r.ActionID)));
          dividends.push(...rows);
          if (rows.length) await db.addDividends(rows);
          const daily = aggregateDividendsByDay(dividends);
          const byAsset = summarizeDividendsByAsset(dividends);
          populateDividendsTable(dividends);
          populateDividendsDailyTable(daily);
          populateDividendsAssetTable(byAsset);
          updateCashChart();
          showToast(`Dividendos importados: ${rows.length} (ign: ${dupCount}).`, rows.length ? 'success' : 'info');
        });
      }

      // OPTIONS
      if (optionsInput && optionsInput.files && optionsInput.files.length) {
        any = true;
        await parseFiles(optionsInput.files, data => { optionsData = data; });
      }

      if (!any) {
        showToast('No hay archivos seleccionados para importar.', 'info');
      }
    });
  }

  populateTransfersTable(transfers);
  const daily = aggregateDividendsByDay(dividends);
  const byAsset = summarizeDividendsByAsset(dividends);
  populateDividendsTable(dividends);
  populateDividendsDailyTable(daily);
  populateDividendsAssetTable(byAsset);
  loadPositions();
  updateCashChart();
  
  // Mostrar toast si venimos de un reset
  try {
    if (localStorage.getItem('portfolioReset') === '1') {
      showToast('Datos locales borrados correctamente.', 'success');
      localStorage.removeItem('portfolioReset');
    }
  } catch (_) {}
  
  // Reset button handler (dentro para capturar db)
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      const ok = confirm('Esto borrará todos los datos locales. ¿Continuar?');
      if (!ok) return;
    try {
      await db.resetDb();
      try { localStorage.setItem('portfolioReset', '1'); } catch(_) {}
    } catch (e) {
      console.error('Error al resetear la base de datos', e);
      showToast('Error al borrar datos locales.', 'error');
    }
    location.reload();
    });
  }
  // Vista por defecto activa
  showView('positions');
}

document.addEventListener('DOMContentLoaded', initApp);

function handleCsv(event, cb, opts = {}) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  Promise.all(files.map(file => new Promise(resolve => {
    Papa.parse(file, Object.assign({
      header: true,
      dynamicTyping: true,
      quote: true,
      complete: results => resolve(results.data)
    }, opts));
  }))).then(results => {
    cb(results.flat());
  });
}

function parseFiles(fileList, cb, opts = {}) {
  const files = Array.from(fileList || []);
  if (!files.length) return Promise.resolve();
  return Promise.all(files.map(file => new Promise(resolve => {
    Papa.parse(file, Object.assign({
      header: true,
      dynamicTyping: true,
      quote: true,
      complete: results => resolve(results.data)
    }, opts));
  }))).then(results => cb(results.flat()));
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const base = 'max-w-sm w-full rounded-md shadow border px-3 py-2 text-sm flex items-start gap-2 transition-opacity duration-300';
  const themes = {
    success: 'bg-green-50 border-green-200 text-green-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    error: 'bg-red-50 border-red-200 text-red-800'
  };
  const div = document.createElement('div');
  div.className = `${base} ${themes[type] || themes.info}`;
  div.setAttribute('role', 'status');
  div.innerHTML = `
    <span class="mt-0.5">${message}</span>
    <button class="ml-auto text-xs opacity-70 hover:opacity-100" aria-label="Cerrar">✕</button>
  `;
  const btn = div.querySelector('button');
  btn.addEventListener('click', () => {
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 250);
  });
  container.appendChild(div);
  setTimeout(() => {
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 250);
  }, 4000);
}

function sanitizeTrades(data) {
  return data.map(row => ({
    TradeID: row.TradeID || row.TradeId || row.OperationID || row.OperationId || row.TransactionID || row.TransactionId || row.ID || row.Id,
    Ticker: row.Ticker || row.Symbol,
    Quantity: parseFloat(row.Quantity ?? row.Cantidad ?? row.Shares ?? 0),
    PurchasePrice: parseFloat(row.PurchasePrice ?? row.PrecioCompra ?? row.Price ?? 0)
  })).filter(r => r.Ticker);
}

// Nuevo: sanea operaciones de IB, atendiendo a STK y CASH
function sanitizeOperations(data) {
  const stocks = [];
  const cash = [];
  data.forEach(row => {
    const assetClass = (row.AssetClass || row.Asset || '').toString().trim().toUpperCase();
    const symbol = row.Symbol || row.Ticker || '';
    const isin = row.ISIN || row.Isin || '';
    const execId = row.IBExecID || row.ExecID || row.ExecutionID || row.ExecutionId || '';
    const qty = parseFloat(row.Quantity ?? row.Shares ?? 0) || 0;
    const price = parseFloat(row.TradePrice ?? row.Price ?? row.PurchasePrice ?? 0) || 0;
    const commission = parseFloat(row.IBComission ?? row.IBCommission ?? row.Commission ?? 0) || 0;
    const commissionCurrency = (row.IBCommissionCurrency || row.CommissionCurrency || '').toString().toUpperCase();
    const currency = (row.CurrencyPrimary || row.Currency || '').toString().toUpperCase();
    const dt = parseDateTime(row.DateTime || row['Date/Time'] || row.Date || row.Fecha);
    if (!dt) return;

    if (assetClass === 'STK' && symbol && isin) {
      stocks.push({
        TradeID: execId || undefined,
        Ticker: symbol,
        Quantity: qty,
        PurchasePrice: price,
        DateTime: dt,
        Commission: commission,
        CommissionCurrency: commissionCurrency,
        CurrencyPrimary: currency,
        ISIN: isin,
        AssetClass: assetClass
      });
      return;
    }
    if (assetClass === 'CASH') {
      // Si es un par FX (p.ej. EUR.USD), generar dos movimientos: salida en base y entrada en cotizada.
      const side = String(row['Buy/Sell'] || row.Side || row.BS || '').trim().toUpperCase();
      if (symbol && symbol.includes('.')) {
        const fxTransfers = buildFxTransfers({ symbol, side, qty, price, commission, commissionCurrency, dt, execId });
        cash.push(...fxTransfers);
        return;
      }
      // No es FX: usar la divisa primaria o derivada y un único movimiento
      const currency = deriveCurrency(row, symbol);
      const commissionAdj = commissionCurrency && commissionCurrency !== currency ? 0 : commission;
      const amount = (qty * price) + commissionAdj;
      const txId = execId ? `CASH:${execId}` : `CASH:${symbol}:${dt.getTime()}:${amount.toFixed(4)}`;
      cash.push({
        TransactionID: txId,
        DateTime: dt,
        Amount: amount,
        CurrencyPrimary: currency
      });
      return;
    }
    // Ignorar resto (opciones u otros sin ISIN)
  });
  return { stocks, cash };
}

function stockTradesToCashRows(stockRows) {
  return stockRows
    .filter(r => r && r.DateTime && r.CurrencyPrimary && typeof r.Quantity === 'number' && typeof r.PurchasePrice === 'number')
    .map(r => {
      const qty = Number(r.Quantity) || 0;
      const price = Number(r.PurchasePrice) || 0;
      const comm = (r.CommissionCurrency && r.CommissionCurrency !== r.CurrencyPrimary) ? 0 : (Number(r.Commission) || 0);
      const amount = qty > 0
        ? -(qty * price) + comm // compra reduce efectivo; comisión suele ser negativa
        : (-qty * price) + comm; // venta aumenta efectivo; comisión negativa resta
      const id = r.TradeID ? `STK:${r.TradeID}` : `STK:${r.Ticker}:${r.DateTime.getTime()}:${qty}:${price}`;
      return {
        TransactionID: id,
        DateTime: r.DateTime,
        Amount: amount,
        CurrencyPrimary: r.CurrencyPrimary
      };
    });
}

function deriveCurrency(row, symbol) {
  const c1 = row.CurrencyPrimary || row.Currency || '';
  if (c1) return String(c1).toUpperCase();
  const s = String(symbol || '').toUpperCase();
  if (s.includes('.')) return s.split('.')[1];
  return s || 'USD';
}

// Construye dos movimientos de caja a partir de una operación FX (AssetClass=CASH, Symbol=BASE.QUOTE)
function buildFxTransfers({ symbol, side, qty, price, commission, commissionCurrency, dt, execId }) {
  const [base, quote] = String(symbol).toUpperCase().split('.');
  const absQty = Math.abs(Number(qty) || 0);
  const rate = Number(price) || 0;
  // Cantidades nominales por pierna, sin comisiones
  let baseAmount = absQty;              // en unidades de BASE
  let quoteAmount = absQty * rate;      // en unidades de QUOTE
  // Direcciones según Buy/Sell: SELL = vendes BASE, compras QUOTE; BUY = compras BASE, pagas con QUOTE
  let baseFlow = 0;   // signo y valor en BASE
  let quoteFlow = 0;  // signo y valor en QUOTE
  if (side === 'SELL') {
    baseFlow = -baseAmount;
    quoteFlow = +quoteAmount;
  } else if (side === 'BUY') {
    baseFlow = +baseAmount;
    quoteFlow = -quoteAmount;
  } else {
    // Si no hay lado definido, inferir por signo de qty: qty < 0 => vendes BASE
    if ((Number(qty) || 0) < 0) {
      baseFlow = -baseAmount;
      quoteFlow = +quoteAmount;
    } else {
      baseFlow = +baseAmount;
      quoteFlow = -quoteAmount;
    }
  }
  // Aplicar comisión en la divisa correspondiente (suele ser negativa)
  const comm = Number(commission) || 0;
  const commCur = String(commissionCurrency || '').toUpperCase();
  if (comm && commCur) {
    if (commCur === base) baseFlow += comm;
    else if (commCur === quote) quoteFlow += comm;
  }
  // IDs estables por pierna
  const idBase = execId ? `FX:${execId}:${base}` : `FX:${symbol}:${dt.getTime()}:${absQty}:${rate}:${side}:${base}`;
  const idQuote = execId ? `FX:${execId}:${quote}` : `FX:${symbol}:${dt.getTime()}:${absQty}:${rate}:${side}:${quote}`;
  return [
    { TransactionID: idBase, DateTime: dt, Amount: baseFlow, CurrencyPrimary: base },
    { TransactionID: idQuote, DateTime: dt, Amount: quoteFlow, CurrencyPrimary: quote }
  ];
}

function sanitizeTransfers(data) {
  return data.map(row => ({
    TransactionID: row.TransactionID || row.TransactionId || row.ID || row.Id,
    CurrencyPrimary: row.CurrencyPrimary,
    DateTime: parseDateTime(row['Date/Time'] || row.DateTime || row.Date),
    Amount: parseFloat(row.Amount)
  })).filter(r => r.TransactionID && r.CurrencyPrimary && r.DateTime && !isNaN(r.Amount));
}

function sanitizeDividends(data) {
  return data
    .filter(row => String(row.Code || row.ActionCode || '').trim() === 'Po')
    .map(row => {
      const gross = parseFloat(row.GrossAmount);
      const tax = parseFloat(row.Tax) || 0;
      return {
        ActionID: row.ActionID || row.ActionId || row.ID || row.Id,
        Ticker: row.Ticker || row.Symbol || row.Underlying || row.Asset,
        CurrencyPrimary: row.CurrencyPrimary || row.Currency,
        DateTime: parseDateTime(row['Date/Time'] || row.Date || row.PaymentDate),
        GrossAmount: isNaN(gross) ? 0 : gross,
        Tax: tax,
        IssuerCountryCode: row.IssuerCountryCode || row.Country || '',
        Amount: (isNaN(gross) ? 0 : gross) + tax
      };
    })
    .filter(r => r.ActionID && r.CurrencyPrimary && r.DateTime && !isNaN(r.GrossAmount));
}

function aggregateDividendsByDay(rows) {
  const map = {};
  rows.forEach(r => {
    const key = r.DateTime.toISOString().slice(0, 10) + r.CurrencyPrimary;
    if (!map[key]) {
      map[key] = { Date: r.DateTime.toISOString().slice(0, 10), Currency: r.CurrencyPrimary, Amount: 0 };
    }
    map[key].Amount += r.Amount;
  });
  return Object.values(map).sort((a, b) => new Date(a.Date) - new Date(b.Date));
}

function summarizeDividendsByAsset(rows) {
  const map = {};
  rows.forEach(r => {
    if (!r.Ticker) return;
    if (!map[r.Ticker]) {
      map[r.Ticker] = { Ticker: r.Ticker, Currency: r.CurrencyPrimary, Amount: 0 };
    }
    map[r.Ticker].Amount += r.Amount;
  });
  return Object.values(map).sort((a, b) => a.Ticker.localeCompare(b.Ticker));
}

function parseDateTime(value) {
  if (!value) return null;
  const clean = String(value).replace(';', ' ').trim();
  const [datePart, timePart = ''] = clean.split(' ');
  const [day, month, year] = datePart.split('/').map(Number);
  if (!day || !month || !year) return null;
  let hours = 0, minutes = 0, seconds = 0;
  if (timePart) {
    const [h = '0', m = '0', s = '0'] = timePart.split(':');
    hours = parseInt(h, 10) || 0;
    minutes = parseInt(m, 10) || 0;
    seconds = parseInt(s, 10) || 0;
  }
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

async function loadPositions() {
  const aggregated = aggregateTradesFifoByTicker(trades);
  const dividendStats = computeDividendStats(dividends);
  const tradeFlows = computeTradeCashFlowByTicker(trades);
  const tickers = Object.keys(aggregated);
  const prices = await fetchPricesBatch(tickers);
  let portfolioTotal = 0;
  const rows = tickers.map(ticker => {
    const t = aggregated[ticker];
    const current = prices[ticker] || 0;
    const currentValue = t.currentQty * current;
    portfolioTotal += currentValue > 0 ? currentValue : 0;
    const div = dividendStats[ticker] || { total: 0, last12m: 0 };
    const last12mPerShare = t.currentQty > 0 ? div.last12m / t.currentQty : 0;
    const unrealizedPct = t.avgCost > 0 ? ((current - t.avgCost) / t.avgCost) * 100 : 0;
    const dividendYieldPct = t.avgCost > 0 ? (last12mPerShare / t.avgCost) * 100 : 0;
    const flow = tradeFlows[ticker] || 0; // flujo neto de compras/ventas + comisiones
    const baseCost = - (flow + (div.total || 0)); // capital neto invertido tras restar dividendos
    const baseCostPerShare = t.currentQty > 0 ? baseCost / t.currentQty : 0;
    return {
      ticker,
      quantity: t.currentQty,
      purchase: t.avgCost,
      baseCost,
      baseCostTotal: baseCost,
      baseCostPerShare,
      div12mPerShare: last12mPerShare,
      totalDividends: div.total,
      current,
      unrealizedPct,
      realizedProfit: t.realizedProfit,
      dividendYieldPct,
      currentValue
    };
  });
  rows.forEach(r => {
    r.weightPct = portfolioTotal > 0 ? (r.currentValue / portfolioTotal) * 100 : 0;
  });
  positionsRows = rows;
  populateTable(getSortedRows(positionsRows));
  drawChart(positionsRows);
}

function aggregateTradesFifoByTicker(trades) {
  const groups = {};
  trades.forEach(tr => {
    if (!tr.Ticker) return;
    if (!groups[tr.Ticker]) groups[tr.Ticker] = [];
    groups[tr.Ticker].push(tr);
  });
  const result = {};
  Object.keys(groups).forEach(ticker => {
    const rows = groups[ticker]
      .slice()
      .sort((a, b) => (a.DateTime?.getTime?.() || 0) - (b.DateTime?.getTime?.() || 0));
    const lots = [];
    let realized = 0;
    rows.forEach(r => {
      const q = Number(r.Quantity) || 0;
      const p = Number(r.PurchasePrice) || 0;
      const comm = Math.abs(Number(r.Commission) || 0);
      if (q > 0) {
        const totalCost = q * p + comm;
        const cps = totalCost / q;
        lots.push({ qty: q, cps });
      } else if (q < 0) {
        let sellQty = -q;
        let sellValuePerShare = p;
        while (sellQty > 0 && lots.length > 0) {
          const lot = lots[0];
          const take = Math.min(lot.qty, sellQty);
          realized += take * (sellValuePerShare - lot.cps);
          lot.qty -= take;
          sellQty -= take;
          if (lot.qty <= 0.0000001) lots.shift();
        }
        // Restar comisión de venta
        realized -= comm;
      }
    });
    const currentQty = lots.reduce((acc, l) => acc + l.qty, 0);
    const totalCostLeft = lots.reduce((acc, l) => acc + l.qty * l.cps, 0);
    const avgCost = currentQty > 0 ? totalCostLeft / currentQty : 0;
    result[ticker] = { currentQty, avgCost, realizedProfit: realized };
  });
  return result;
}

function computeDividendStats(divs) {
  const map = {};
  const now = Date.now();
  const lastYear = now - 365 * 24 * 60 * 60 * 1000;
  divs.forEach(d => {
    const t = d.Ticker;
    if (!t) return;
    if (!map[t]) map[t] = { total: 0, last12m: 0 };
    map[t].total += Number(d.Amount) || 0;
    const time = d.DateTime instanceof Date ? d.DateTime.getTime() : 0;
    if (time >= lastYear) map[t].last12m += Number(d.Amount) || 0;
  });
  return map;
}

function computeTradeCashFlowByTicker(trs) {
  const map = {};
  trs.forEach(r => {
    if (!r.Ticker) return;
    const qty = Number(r.Quantity) || 0;
    const price = Number(r.PurchasePrice) || 0;
    const comm = Number(r.Commission) || 0;
    const amount = qty > 0
      ? -(qty * price) + comm
      : (-qty * price) + comm;
    map[r.Ticker] = (map[r.Ticker] || 0) + amount;
  });
  return map;
}

async function fetchPricesBatch(tickers) {
  const entries = await Promise.all(tickers.map(async t => [t, await fetchPrice(t)]));
  return Object.fromEntries(entries);
}

async function fetchPrice(ticker) {
  try {
    const resp = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`);
    const json = await resp.json();
    return json.quoteResponse.result[0].regularMarketPrice || 0;
  } catch (e) {
    console.error('Error fetching price for', ticker, e);
    if (!priceErrorShown.has(ticker)) {
      showToast(`No se pudo obtener el precio para ${ticker}.`, 'error');
      priceErrorShown.add(ticker);
    }
    return 0;
  }
}

function getSortedRows(rows) {
  const key = sortState.key;
  const dir = sortState.dir === 'asc' ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (key === 'ticker') {
      return String(va).localeCompare(String(vb)) * dir;
    }
    const na = Number(va) || 0;
    const nb = Number(vb) || 0;
    return (na - nb) * dir;
  });
  return copy;
}

function populateTable(rows) {
  positionsBody.innerHTML = '';
  // Ordenar por peso desc.
  const sorted = rows;
  sorted.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-1">${r.ticker}</td>
      <td class="px-3 py-1">${formatNumber(r.quantity)}</td>
      <td class="px-3 py-1">${formatMoney(r.purchase)}</td>
      <td class="px-3 py-1">${formatMoney(r.baseCostPerShare)}</td>
      <td class="px-3 py-1">${formatMoney(r.baseCostTotal)}</td>
      <td class="px-3 py-1">${formatMoney(r.div12mPerShare)}</td>
      <td class="px-3 py-1">${formatMoney(r.totalDividends)}</td>
      <td class="px-3 py-1">${formatPercent(r.weightPct)}</td>
      <td class="px-3 py-1">${formatMoney(r.current)}</td>
      <td class="px-3 py-1">${formatMoney(r.currentValue)}</td>
      <td class="px-3 py-1">${formatPercent(r.unrealizedPct)}</td>
      <td class="px-3 py-1">${formatMoney(r.realizedProfit)}</td>
      <td class="px-3 py-1">${formatPercent(r.dividendYieldPct)}</td>`;
    positionsBody.appendChild(tr);
  });
}

function formatNumber(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function formatMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPercent(n) {
  const v = Number(n) || 0;
  return `${v.toFixed(2)}%`;
}

function populateTransfersTable(rows) {
  transfersBody.innerHTML = '';
  const sorted = [...rows].sort((a, b) => a.DateTime - b.DateTime);
  sorted.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-1">${r.DateTime.toLocaleDateString()}</td>
      <td class="px-3 py-1">${r.Amount.toFixed(2)}</td>
      <td class="px-3 py-1">${r.CurrencyPrimary}</td>`;
    transfersBody.appendChild(tr);
  });
}

function populateDividendsTable(rows) {
  dividendsBody.innerHTML = '';
  const sorted = [...rows].sort((a, b) => a.DateTime - b.DateTime);
  sorted.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-1">${r.DateTime.toLocaleDateString()}</td>
      <td class="px-3 py-1">${r.Amount.toFixed(2)}</td>
      <td class="px-3 py-1">${r.CurrencyPrimary}</td>
      <td class="px-3 py-1">${r.Ticker || ''}</td>
      <td class="px-3 py-1">${r.Tax.toFixed(2)}</td>
      <td class="px-3 py-1">${r.IssuerCountryCode}</td>`;
    dividendsBody.appendChild(tr);
  });
}

function populateDividendsDailyTable(rows) {
  dividendsDailyBody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-1">${new Date(r.Date).toLocaleDateString()}</td>
      <td class="px-3 py-1">${r.Amount.toFixed(2)}</td>
      <td class="px-3 py-1">${r.Currency}</td>`;
    dividendsDailyBody.appendChild(tr);
  });
}

function populateDividendsAssetTable(rows) {
  dividendsAssetBody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-1">${r.Ticker}</td>
      <td class="px-3 py-1">${r.Amount.toFixed(2)}</td>
      <td class="px-3 py-1">${r.Currency}</td>`;
    dividendsAssetBody.appendChild(tr);
  });
}

function drawChart(rows) {
  const labels = rows.map(r => r.ticker);
  const values = rows.map(r => r.currentValue || (r.current * r.quantity));

  if (positionsChart) positionsChart.destroy();
  const canvas = document.getElementById('positionsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  positionsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Valor por acción',
        data: values,
        backgroundColor: 'rgba(54, 162, 235, 0.5)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

function computeCashHistory(rows) {
  const sorted = [...rows].sort((a, b) => a.DateTime - b.DateTime);
  const histories = {};
  sorted.forEach(r => {
    const currency = r.CurrencyPrimary;
    const date = r.DateTime;
    const amount = parseFloat(r.Amount) || 0;
    if (!histories[currency]) histories[currency] = [];
    const last = histories[currency].length
      ? histories[currency][histories[currency].length - 1].y
      : 0;
    histories[currency].push({ x: date, y: last + amount });
  });
  return histories;
}

function updateCashChart() {
  const all = [...transfers, ...dividends];
  drawCashChart(all);
  // Listado de operaciones en efectivo: solo transferencias y FX (excluye dividendos y STK derivados)
  try { populateCashOpsTable(transfers); } catch(_) {}
}

function drawCashChart(rows) {
  const histories = computeCashHistory(rows);
  const colors = [
    'rgba(75, 192, 192, 1)',
    'rgba(54, 162, 235, 1)',
    'rgba(255, 99, 132, 1)',
    'rgba(255, 206, 86, 1)'
  ];
  const datasets = Object.keys(histories).map((currency, i) => ({
    label: currency,
    data: histories[currency],
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length],
    fill: false
  }));

  // Si no hay datos de efectivo, no sobrescribimos una gráfica existente
  if (datasets.length === 0) return;
  if (cashChart) cashChart.destroy();
  const canvas = document.getElementById('cashChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  cashChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      scales: {
        x: { type: 'time', time: { unit: 'day' } },
        y: { beginAtZero: true }
      }
    }
  });
}

function getCashRowType(row) {
  const id = String(row.TransactionID || '');
  if (id.startsWith('FX:')) return 'FX';
  if (id.startsWith('STK:')) return 'STK';
  if (id.startsWith('CASH:')) return 'CASH';
  return 'Transferencia';
}

function populateCashOpsTable(rows) {
  if (!cashOpsBody) return;
  cashOpsBody.innerHTML = '';
  // Mostrar transferencias puras y FX; dejar fuera STK si se desea filtrar estrictamente
  const filtered = rows.filter(r => {
    const t = getCashRowType(r);
    return t === 'Transferencia' || t === 'FX' || t === 'CASH';
  });
  const sorted = [...filtered].sort((a, b) => a.DateTime - b.DateTime);
  sorted.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-1">${r.DateTime.toLocaleDateString()}</td>
      <td class="px-3 py-1">${(Number(r.Amount)||0).toFixed(2)}</td>
      <td class="px-3 py-1">${r.CurrencyPrimary}</td>
      <td class="px-3 py-1">${getCashRowType(r)}</td>`;
    cashOpsBody.appendChild(tr);
  });
}
