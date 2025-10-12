// persistence.js - database layer using SQL.js
let sqlReady;
let db;

async function initDb() {
  console.log("iniciando base de datos");
  if (db) return db;
  if (!sqlReady) {
    sqlReady = initSqlJs({
      locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
    });
  }
  const SQL = await sqlReady;
  const saved = localStorage.getItem('portfolioDB');
  if (saved) {
    const binary = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
    db = new SQL.Database(binary);
  } else {
    db = new SQL.Database();
    db.run(`CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, ticker TEXT, quantity REAL, purchase REAL, date INTEGER, commission REAL);
            CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, date INTEGER, amount REAL, currency TEXT);
            CREATE TABLE IF NOT EXISTS dividends (id TEXT PRIMARY KEY, date INTEGER, amount REAL, currency TEXT, ticker TEXT, tax REAL, country TEXT);`);
    saveDb();
  }
  ensureSchema();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const b64 = btoa(String.fromCharCode.apply(null, data));
  localStorage.setItem('portfolioDB', b64);
}

async function addTrades(rows) {
  if (!rows.length) return;
  const db = await initDb();
  // Deduplicación: prioriza ID cuando existe, si no por (ticker, quantity, purchase)
  const existing = db.exec('SELECT id, ticker, quantity, purchase FROM trades');
  const idSet = new Set(existing.length ? existing[0].values.map(v => v[0]) : []);
  const keySet = new Set(existing.length ? existing[0].values.map(v => `${v[1]}|${v[2]}|${v[3]}`) : []);
  const toInsert = rows.filter(r => {
    const id = r.TradeID || r.id;
    if (id) return !idSet.has(String(id));
    return !keySet.has(`${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`);
  });
  if (!toInsert.length) return;
  const stmt = db.prepare('INSERT OR IGNORE INTO trades (id, ticker, quantity, purchase, date, commission) VALUES (?,?,?,?,?,?)');
  db.run('BEGIN TRANSACTION');
  toInsert.forEach(r => stmt.run([
    String(r.TradeID || r.id || `legacy:${r.Ticker}|${r.Quantity}|${r.PurchasePrice}`),
    r.Ticker,
    r.Quantity,
    r.PurchasePrice,
    r.DateTime instanceof Date ? r.DateTime.getTime() : null,
    typeof r.Commission === 'number' ? r.Commission : null
  ]));
  db.run('COMMIT');
  stmt.free();
  saveDb();
}

async function addTransfers(rows) {
  if (!rows.length) return;
  const db = await initDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO transfers VALUES (?,?,?,?)');
  db.run('BEGIN TRANSACTION');
  rows.forEach(r => stmt.run([String(r.TransactionID), r.DateTime.getTime(), r.Amount, r.CurrencyPrimary]));
  db.run('COMMIT');
  stmt.free();
  saveDb();
}

async function addDividends(rows) {
  if (!rows.length) return;
  const db = await initDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO dividends VALUES (?,?,?,?,?,?,?)');
  db.run('BEGIN TRANSACTION');
  rows.forEach(r => stmt.run([String(r.ActionID), r.DateTime.getTime(), r.Amount, r.CurrencyPrimary, r.Ticker || '', r.Tax, r.IssuerCountryCode]));
  db.run('COMMIT');
  stmt.free();
  saveDb();
}

async function getTrades() {
  const db = await initDb();
  const res = db.exec('SELECT id, ticker AS Ticker, quantity AS Quantity, purchase AS PurchasePrice, date AS Date, commission AS Commission FROM trades');
  if (!res.length) return [];
  return res[0].values.map(row => ({
    TradeID: row[0],
    Ticker: row[1],
    Quantity: row[2],
    PurchasePrice: row[3],
    DateTime: row[4] ? new Date(row[4]) : null,
    Commission: row[5] ?? null
  }));
}

async function getTransfers() {
  const db = await initDb();
  const res = db.exec('SELECT id, date, amount, currency FROM transfers');
  if (!res.length) return [];
  return res[0].values.map(row => ({
    TransactionID: row[0],
    DateTime: new Date(row[1]),
    Amount: row[2],
    CurrencyPrimary: row[3]
  }));
}

async function getDividends() {
  const db = await initDb();
  const res = db.exec('SELECT id, date, amount, currency, ticker, tax, country FROM dividends');
  if (!res.length) return [];
  return res[0].values.map(row => ({
    ActionID: row[0],
    DateTime: new Date(row[1]),
    Amount: row[2],
    CurrencyPrimary: row[3],
    Ticker: row[4],
    Tax: row[5],
    IssuerCountryCode: row[6]
  }));
}

function resetDb() {
  localStorage.removeItem('portfolioDB');
  try {
    if (db && typeof db.close === 'function') db.close();
  } catch (_) {}
  db = null;
}

window.db = { initDb, addTrades, addTransfers, addDividends, getTrades, getTransfers, getDividends, resetDb };

function ensureSchema() {
  try {
    const info = db.exec("PRAGMA table_info(trades)");
    const cols = info.length ? info[0].values.map(v => v[1]) : [];
    if (cols.length && cols.indexOf('id') === -1) {
      db.run('BEGIN TRANSACTION');
      db.run('CREATE TABLE trades_new (id TEXT PRIMARY KEY, ticker TEXT, quantity REAL, purchase REAL, date INTEGER, commission REAL)');
      db.run("INSERT INTO trades_new (id, ticker, quantity, purchase, date, commission) SELECT 'legacy:' || ticker || '|' || quantity || '|' || purchase, ticker, quantity, purchase, NULL, NULL FROM trades");
      db.run('DROP TABLE trades');
      db.run('ALTER TABLE trades_new RENAME TO trades');
      db.run('COMMIT');
      saveDb();
    }
    // Añadir columnas nuevas si faltan (date, commission)
    if (cols.indexOf('date') === -1) {
      db.run("ALTER TABLE trades ADD COLUMN date INTEGER");
    }
    if (cols.indexOf('commission') === -1) {
      db.run("ALTER TABLE trades ADD COLUMN commission REAL");
    }
  } catch (e) {
    // noop
  }
}
