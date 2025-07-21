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
  trades = data.filter(row => row.Ticker);
  loadPositions();
}));

transfersInput.addEventListener('change', event => handleCsv(event, data => {
  transfers = data;
  console.log('Transfers loaded', transfers);
}));

dividendsInput.addEventListener('change', event => handleCsv(event, data => {
  dividends = data;
  console.log('Dividends loaded', dividends);
}));

optionsInput.addEventListener('change', event => handleCsv(event, data => {
  optionsData = data;
  console.log('Options loaded', optionsData);
}));

function handleCsv(event, cb) {
  const file = event.target.files[0];
  if (!file) return;
  Papa.parse(file, {
    header: true,
    dynamicTyping: true,
    complete: function(results) {
      cb(results.data);
    }
  });
}

async function loadPositions() {
  const rows = await Promise.all(trades.map(loadPosition));
  populateTable(rows);
  drawChart(rows);
}

async function loadPosition(row) {
  const ticker = row.Ticker;
  const quantity = row.Cantidad || row.Quantity || row.Shares || 0;
  const purchase = row.PrecioCompra || row.PurchasePrice || row.Price || 0;
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
