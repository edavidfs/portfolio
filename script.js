const csvInput = document.getElementById('csvInput');
const positionsBody = document.querySelector('#positionsTable tbody');
let chart;

csvInput.addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;

  Papa.parse(file, {
    header: true,
    dynamicTyping: true,
    complete: async function(results) {
      const data = results.data.filter(row => row.Ticker);
      const rows = await Promise.all(data.map(loadPosition));
      populateTable(rows);
      drawChart(rows);
    }
  });
});

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
      <td>${r.ticker}</td>
      <td>${r.quantity}</td>
      <td>${r.purchase.toFixed(2)}</td>
      <td>${r.current.toFixed(2)}</td>
      <td>${r.profitPct.toFixed(2)}%</td>
      <td>${r.profit.toFixed(2)}</td>`;
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
