const tradesInput = document.getElementById('tradesInput');
const transfersInput = document.getElementById('transfersInput');
const dividendsInput = document.getElementById('dividendsInput');
const optionsInput = document.getElementById('optionsInput');
const positionsBody = document.querySelector('#positionsTable tbody');
const transfersBody = document.querySelector('#transfersTable tbody');
const dividendsBody = document.querySelector('#dividendsTable tbody');
const dividendsDailyBody = document.querySelector('#dividendsDailyTable tbody');
const dividendsAssetBody = document.querySelector('#dividendsAssetTable tbody');
const tabButtons = document.querySelectorAll('#incomeTabs .tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
let chart;
let trades = [];
let transfers = [];
let transferIds = new Set();
let dividends = [];
let optionsData = [];

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab + 'Tab';
    tabPanels.forEach(p => p.classList.add('hidden'));
    tabButtons.forEach(b => b.classList.remove('border-indigo-600', 'text-indigo-600'));
    document.getElementById(target).classList.remove('hidden');
    btn.classList.add('border-indigo-600', 'text-indigo-600');
  });
});

tradesInput.addEventListener('change', event => handleCsv(event, data => {
  trades = sanitizeTrades(data);
  loadPositions();
}));

transfersInput.addEventListener('change', event => handleCsv(event, data => {
  const rows = sanitizeTransfers(data);
  rows.forEach(r => {
    if (!transferIds.has(r.TransactionID)) {
      transferIds.add(r.TransactionID);
      transfers.push(r);
    }
  });
  populateTransfersTable(transfers);
  updateCashChart();
}));

dividendsInput.addEventListener('change', event => handleCsv(event, data => {
  dividends = sanitizeDividends(data);
  const daily = aggregateDividendsByDay(dividends);
  const byAsset = summarizeDividendsByAsset(dividends);
  populateDividendsTable(dividends);
  populateDividendsDailyTable(daily);
  populateDividendsAssetTable(byAsset);
  updateCashChart();
}));

optionsInput.addEventListener('change', event => handleCsv(event, data => {
  optionsData = data;
}));

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

function sanitizeTrades(data) {
  return data.map(row => ({
    Ticker: row.Ticker || row.Symbol,
    Quantity: parseFloat(row.Quantity ?? row.Cantidad ?? row.Shares ?? 0),
    PurchasePrice: parseFloat(row.PurchasePrice ?? row.PrecioCompra ?? row.Price ?? 0)
  })).filter(r => r.Ticker);
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
  return data.map(row => ({
    Ticker: row.Ticker || row.Symbol || row.Underlying || row.Asset,
    CurrencyPrimary: row.CurrencyPrimary || row.Currency,
    DateTime: parseDateTime(row['Date/Time'] || row.Date || row.PaymentDate),
    Amount: parseFloat(row.Amount ?? row.Net ?? row.NetAmount)
  })).filter(r => r.CurrencyPrimary && r.DateTime && !isNaN(r.Amount));
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
  const rows = await Promise.all(trades.map(loadPosition));
  populateTable(rows);
  drawChart(rows);
}

async function loadPosition(row) {
  const ticker = row.Ticker;
  const quantity = row.Quantity || 0;
  const purchase = row.PurchasePrice || 0;
  const current = await fetchPrice(ticker);
  const profit = (current - purchase) * quantity;
  const profitPct = purchase ? (profit / (purchase * quantity)) * 100 : 0;
  return { ticker, quantity, purchase, current, profit, profitPct };
}

async function fetchPrice(ticker) {
  try {
    const resp = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`);
    const json = await resp.json();
    return json.quoteResponse.result[0].regularMarketPrice || 0;
  } catch (e) {
    console.error('Error fetching price for', ticker, e);
    return 0;
  }
}

function populateTable(rows) {
  positionsBody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-1">${r.ticker}</td>
      <td class="px-3 py-1">${r.quantity}</td>
      <td class="px-3 py-1">${r.purchase.toFixed(2)}</td>
      <td class="px-3 py-1">${r.current.toFixed(2)}</td>
      <td class="px-3 py-1">${r.profitPct.toFixed(2)}%</td>
      <td class="px-3 py-1">${r.profit.toFixed(2)}</td>`;
    positionsBody.appendChild(tr);
  });
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
      <td class="px-3 py-1">${r.Ticker || ''}</td>`;
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
  const values = rows.map(r => r.current * r.quantity);

  if (chart) chart.destroy();

  const ctx = document.getElementById('portfolioChart').getContext('2d');
  chart = new Chart(ctx, {
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

  if (chart) chart.destroy();

  const ctx = document.getElementById('portfolioChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'day'
          },
        },
        y: {
          beginAtZero: true
        }
      }
    }
  });
}
