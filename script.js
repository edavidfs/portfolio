const tradesInput = document.getElementById('tradesInput');
const transfersInput = document.getElementById('transfersInput');
const dividendsInput = document.getElementById('dividendsInput');
const optionsInput = document.getElementById('optionsInput');
const positionsBody = document.querySelector('#positionsTable tbody');
let chart;
let trades = [];
let transfers = [];
let dividends = [];
let optionsData = [];

tradesInput.addEventListener('change', event => handleCsv(event, data => {
  trades = sanitizeTrades(data);
  loadPositions();
}));

transfersInput.addEventListener('change', event => handleCsv(event, data => {
  transfers = sanitizeTransfers(data);
  drawCashChart(transfers);
}));

dividendsInput.addEventListener('change', event => handleCsv(event, data => {
  dividends = data;
  console.log('Dividends loaded', dividends);
}));

optionsInput.addEventListener('change', event => handleCsv(event, data => {
  optionsData = data;
  console.log('Options loaded', optionsData);
}));

function handleCsv(event, cb, opts = {}) {
  const file = event.target.files[0];
  if (!file) return;
  Papa.parse(file, Object.assign({
    header: true,
    dynamicTyping: true,
    complete: function(results) {
      cb(results.data);
    }
  }, opts));
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
    CurrencyPrimary: row.CurrencyPrimary,
    DateTime: parseDateTime(row['Date/Time'] || row.DateTime || row.Date),
    Amount: parseFloat(row.Amount)
  })).filter(r => r.CurrencyPrimary && r.DateTime && !isNaN(r.Amount));
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

function drawChart(rows) {
  const labels = rows.map(r => r.ticker);
  const values = rows.map(r => r.current * r.quantity);

  if (chart) chart.destroy();

  const ctx = document.getElementById('portfolioChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'bar',
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
      parsing: false,
      responsive: true,
      scales: {
        x: {
          type: 'time'
        },
        y: {
          beginAtZero: true
        }
      }
    }
  });
}
