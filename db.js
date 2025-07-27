let SQL, db;

async function initDatabase() {
  SQL = await initSqlJs({
    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
  });
  const saved = localStorage.getItem('portfolioDb');
  if (saved) {
    const bytes = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
    db = new SQL.Database(bytes);
  } else {
    db = new SQL.Database();
    createTables();
  }
}

function createTables() {
  db.run(`CREATE TABLE IF NOT EXISTS trades(ticker TEXT, quantity REAL, purchase REAL);`);
  db.run(`CREATE TABLE IF NOT EXISTS transfers(currency TEXT, datetime TEXT, amount REAL);`);
}

function saveDb() {
  const data = db.export();
  const base64 = btoa(String.fromCharCode.apply(null, data));
  localStorage.setItem('portfolioDb', base64);
}

function loadTrades() {
  if (!db) return [];
  const res = db.exec('SELECT ticker, quantity, purchase FROM trades');
  if (!res.length) return [];
  return res[0].values.map(r => ({ Ticker: r[0], Quantity: r[1], PurchasePrice: r[2] }));
}

function loadTransfers() {
  if (!db) return [];
  const res = db.exec('SELECT currency, datetime, amount FROM transfers');
  if (!res.length) return [];
  return res[0].values.map(r => ({ CurrencyPrimary: r[0], DateTime: new Date(r[1]), Amount: r[2] }));
}

function storeTrades(rows) {
  if (!db) return;
  db.run('DELETE FROM trades');
  const stmt = db.prepare('INSERT INTO trades VALUES (?, ?, ?)');
  rows.forEach(r => stmt.run([r.Ticker, r.Quantity, r.PurchasePrice]));
  stmt.free();
  saveDb();
}

function storeTransfers(rows) {
  if (!db) return;
  db.run('DELETE FROM transfers');
  const stmt = db.prepare('INSERT INTO transfers VALUES (?, ?, ?)');
  rows.forEach(r => stmt.run([r.CurrencyPrimary, r.DateTime.toISOString(), r.Amount]));
  stmt.free();
  saveDb();
}

window.db = { initDatabase, loadTrades, loadTransfers, storeTrades, storeTransfers };
