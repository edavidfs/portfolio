// persistence.js - database layer using SQL.js
let sqlReady;
let db;

async function initDb() {
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
    db.run(`CREATE TABLE IF NOT EXISTS trades (ticker TEXT, quantity REAL, purchase REAL);
            CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, date INTEGER, amount REAL, currency TEXT);
            CREATE TABLE IF NOT EXISTS dividends (id TEXT PRIMARY KEY, date INTEGER, amount REAL, currency TEXT, ticker TEXT, tax REAL, country TEXT);`);
    saveDb();
  }
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
  const stmt = db.prepare('INSERT INTO trades VALUES (?,?,?)');
  db.run('BEGIN TRANSACTION');
  rows.forEach(r => stmt.run([r.Ticker, r.Quantity, r.PurchasePrice]));
  db.run('COMMIT');
  stmt.free();
  saveDb();
}

async function addTransfers(rows) {
  if (!rows.length) return;
  const db = await initDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO transfers VALUES (?,?,?,?)');
  db.run('BEGIN TRANSACTION');
  rows.forEach(r => stmt.run([r.TransactionID, r.DateTime.getTime(), r.Amount, r.CurrencyPrimary]));
  db.run('COMMIT');
  stmt.free();
  saveDb();
}

async function addDividends(rows) {
  if (!rows.length) return;
  const db = await initDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO dividends VALUES (?,?,?,?,?,?,?)');
  db.run('BEGIN TRANSACTION');
  rows.forEach(r => stmt.run([r.ActionID, r.DateTime.getTime(), r.Amount, r.CurrencyPrimary, r.Ticker || '', r.Tax, r.IssuerCountryCode]));
  db.run('COMMIT');
  stmt.free();
  saveDb();
}

async function getTrades() {
  const db = await initDb();
  const res = db.exec('SELECT ticker AS Ticker, quantity AS Quantity, purchase AS PurchasePrice FROM trades');
  if (!res.length) return [];
  return res[0].values.map(row => ({ Ticker: row[0], Quantity: row[1], PurchasePrice: row[2] }));
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

window.db = { initDb, addTrades, addTransfers, addDividends, getTrades, getTransfers, getDividends };
