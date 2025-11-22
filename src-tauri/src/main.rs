#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::{
  ffi::OsString,
  fs::{self, OpenOptions},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::Mutex,
  thread,
  time::{Duration, SystemTime, UNIX_EPOCH}
};
use tauri::{
  menu::{Menu, MenuItem, Submenu},
  Manager, RunEvent
};
use std::net::TcpStream;

const DB_SCRIPT: &str = include_str!("../../backend/db.py");
const IMPORTER_SCRIPT: &str = include_str!("../../backend/importer.py");

const BACKEND_URL: &str = "http://127.0.0.1:8000";

struct BackendPaths {
  data_dir: PathBuf,
  backend_dir: PathBuf,
  importer_path: PathBuf,
  db_path: PathBuf,
  log_path: PathBuf,
}

#[derive(Default)]
struct BackendProcess(Mutex<Option<Child>>);

#[derive(Serialize)]
struct BackendInfo {
  db_path: String,
  exists: bool,
  transfers: usize,
}

#[derive(Serialize)]
struct TransferDto {
  transaction_id: String,
  currency: String,
  datetime: String,
  amount: f64,
}

#[derive(Serialize)]
struct TradeDto {
  trade_id: String,
  ticker: Option<String>,
  quantity: f64,
  purchase: f64,
  datetime: Option<String>,
  commission: Option<f64>,
  commission_currency: Option<String>,
  currency: Option<String>,
  isin: Option<String>,
  asset_class: Option<String>,
}

#[tauri::command]
async fn import_csv(
  app_handle: tauri::AppHandle,
  paths: Vec<String>,
  kind: String
) -> Result<(), String> {
  if paths.is_empty() {
    return Err("No se proporcionaron rutas de CSV.".into());
  }
  let backend = prepare_backend(&app_handle)?;
  run_importer(&backend, &kind, &[], &paths, None)?;
  Ok(())
}

#[tauri::command]
async fn import_transfer_payload(
  app_handle: tauri::AppHandle,
  rows: Vec<Value>
) -> Result<(), String> {
  if rows.is_empty() {
    return Err("No se recibieron filas para importar.".into());
  }
  let backend = prepare_backend(&app_handle)?;
  let payload_dir = backend.backend_dir.join("payloads");
  fs::create_dir_all(&payload_dir)
    .map_err(|e| format!("No se pudo preparar la carpeta de payloads: {e}"))?;
  let ts = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0);
  let payload_path = payload_dir.join(format!("transfers-{ts}.json"));
  let serialized =
    serde_json::to_string(&rows).map_err(|e| format!("No se pudo serializar el payload: {e}"))?;
  fs::write(&payload_path, serialized)
    .map_err(|e| format!("No se pudo escribir el payload temporal: {e}"))?;
  let result = run_importer(&backend, "transfers", &[], &[], Some(payload_path.as_path()));
  let _ = fs::remove_file(&payload_path);
  result?;
  Ok(())
}

#[tauri::command]
async fn ensure_backend(app_handle: tauri::AppHandle) -> Result<BackendInfo, String> {
  let backend = prepare_backend(&app_handle)?;
  run_importer(&backend, "init", &["--init-only"], &[], None)?;
  backend_summary(&backend)
}

#[tauri::command]
async fn load_transfers(app_handle: tauri::AppHandle) -> Result<Vec<TransferDto>, String> {
  let backend = prepare_backend(&app_handle)?;
  if !backend.db_path.exists() {
    return Ok(vec![]);
  }
  let conn = Connection::open(&backend.db_path)
    .map_err(|e| format!("No se pudo abrir la base de datos: {e}"))?;
  let mut stmt = conn
    .prepare("SELECT transaction_id, currency, datetime, amount FROM transfers ORDER BY datetime ASC")
    .map_err(|e| format!("Consulta inválida: {e}"))?;
  let rows = stmt
    .query_map([], |row| {
      Ok(TransferDto {
        transaction_id: row.get(0)?,
        currency: row.get(1)?,
        datetime: row.get(2)?,
        amount: row.get(3)?,
      })
    })
    .map_err(|e| format!("No se pudo iterar sobre transferencias: {e}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("No se pudieron cargar transferencias: {e}"))?;
  Ok(rows)
}

#[tauri::command]
async fn load_trades(app_handle: tauri::AppHandle) -> Result<Vec<TradeDto>, String> {
  let backend = prepare_backend(&app_handle)?;
  if !backend.db_path.exists() {
    return Ok(vec![]);
  }
  let conn = Connection::open(&backend.db_path)
    .map_err(|e| format!("No se pudo abrir la base de datos: {e}"))?;
  let mut stmt = conn
    .prepare("SELECT trade_id, ticker, quantity, purchase, datetime, commission, commission_currency, currency, isin, asset_class FROM trades ORDER BY datetime ASC")
    .map_err(|e| format!("Consulta inválida: {e}"))?;
  let rows = stmt
    .query_map([], |row| {
      Ok(TradeDto {
        trade_id: row.get::<_, String>(0)?,
        ticker: row.get(1).ok(),
        quantity: row.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
        purchase: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
        datetime: row.get(4).ok(),
        commission: row.get(5).ok(),
        commission_currency: row.get(6).ok(),
        currency: row.get(7).ok(),
        isin: row.get(8).ok(),
        asset_class: row.get(9).ok(),
      })
    })
    .map_err(|e| format!("No se pudo iterar sobre operaciones: {e}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("No se pudieron cargar operaciones: {e}"))?;
  Ok(rows)
}

fn prepare_backend(app_handle: &tauri::AppHandle) -> Result<BackendPaths, String> {
  let data_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| format!("No se pudo resolver la carpeta de datos del usuario: {e}"))?;
  fs::create_dir_all(&data_dir)
    .map_err(|e| format!("No se pudo crear la carpeta de datos: {e}"))?;
  let backend_dir = data_dir.join("backend");
  fs::create_dir_all(&backend_dir)
    .map_err(|e| format!("No se pudo preparar la carpeta del backend: {e}"))?;
  write_backend_scripts(&backend_dir)?;
  let importer_path = backend_dir.join("importer.py");
  let db_path = data_dir.join("portfolio.db");
  let log_path = data_dir.join("backend.log");
  Ok(BackendPaths { data_dir, backend_dir, importer_path, db_path, log_path })
}

fn run_importer(
  backend: &BackendPaths,
  kind: &str,
  extra_args: &[&str],
  files: &[String],
  payload: Option<&Path>
) -> Result<(), String> {
  let mut command = Command::new("python3");
  command
    .arg(&backend.importer_path)
    .arg("--db")
    .arg(&backend.db_path)
    .arg("--kind")
    .arg(kind)
    .arg("--log")
    .arg(&backend.log_path);
  for arg in extra_args {
    command.arg(arg);
  }
  for file in files {
    command.arg(file);
  }
  if let Some(p) = payload {
    command.arg("--payload").arg(p);
  }
  let output = command
    .output()
    .map_err(|e| format!("No se pudo ejecutar python3: {e}"))?;
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    return Err(format!("Falló la importación: {stderr}"));
  }
  Ok(())
}

fn backend_summary(backend: &BackendPaths) -> Result<BackendInfo, String> {
  let exists = backend.db_path.exists();
  let transfers = if exists {
    count_transfers(&backend.db_path)?
  } else {
    0
  };
  Ok(BackendInfo {
    db_path: backend.db_path.to_string_lossy().into_owned(),
    exists,
    transfers,
  })
}

fn count_transfers(db_path: &Path) -> Result<usize, String> {
  let conn = Connection::open(db_path)
    .map_err(|e| format!("No se pudo abrir la base de datos: {e}"))?;
  let total: i64 = conn
    .query_row("SELECT COUNT(*) FROM transfers", [], |row| row.get(0))
    .map_err(|e| format!("No se pudo contar transferencias: {e}"))?;
  Ok(total as usize)
}

fn write_backend_scripts(dir: &Path) -> Result<(), String> {
  fs::write(dir.join("db.py"), DB_SCRIPT)
    .map_err(|e| format!("No se pudo escribir db.py: {e}"))?;
  fs::write(dir.join("importer.py"), IMPORTER_SCRIPT)
    .map_err(|e| format!("No se pudo escribir importer.py: {e}"))?;
  Ok(())
}

fn spawn_backend_process(app: &tauri::App) -> Result<Child, String> {
  if std::env::var("PORTFOLIO_NO_BACKEND").is_ok() {
    return Err("PORTFOLIO_NO_BACKEND está definido; omitiendo backend embebido.".into());
  }
  let backend_dir = locate_backend_dir()?;
  let python = detect_python(&backend_dir);
  let mut cmd = Command::new(&python);
  cmd.args([
    "-m",
    "uvicorn",
    "backend.api.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ]);
  let parent = backend_dir.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| backend_dir.clone());
  cmd.current_dir(&backend_dir);
  if let Ok(data_dir) = app.path().app_data_dir() {
    let db_path = data_dir.join("portfolio.db");
    cmd.env("PORTFOLIO_DB_PATH", db_path);
  }
  cmd.env("PYTHONPATH", parent);
  cmd.stdin(Stdio::null());
  if let Ok(data_dir) = app.path().app_data_dir() {
    let log_path = data_dir.join("backend-fastapi.log");
    if let Ok(log_file) = OpenOptions::new().create(true).append(true).open(&log_path) {
      if let Ok(err_file) = log_file.try_clone() {
        cmd.stdout(Stdio::from(log_file));
        cmd.stderr(Stdio::from(err_file));
        eprintln!("FastAPI backend log: {}", log_path.display());
      }
    }
  } else {
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
  }
  eprintln!("Iniciando backend FastAPI en {}", python.to_string_lossy());
  let child = cmd
    .spawn()
    .map_err(|e| format!("No se pudo iniciar el backend FastAPI: {e}"))?;
  wait_for_backend_ready()?;
  eprintln!("Backend FastAPI listo en {}", BACKEND_URL);
  Ok(child)
}

fn locate_backend_dir() -> Result<PathBuf, String> {
  if let Ok(dir) = std::env::var("PORTFOLIO_BACKEND_DIR") {
    let path = PathBuf::from(dir);
    if path.exists() {
      return Ok(path);
    }
  }
  let cwd = std::env::current_dir()
    .map_err(|e| format!("No se pudo resolver el directorio actual: {e}"))?;
  if cwd.ends_with("src-tauri") {
    if let Some(parent) = cwd.parent() {
      let candidate = parent.join("backend");
      if candidate.exists() {
        return Ok(candidate);
      }
    }
  }
  let fallback = cwd.join("backend");
  if fallback.exists() {
    Ok(fallback)
  } else {
    Err("No se encontró la carpeta backend. Usa PORTFOLIO_BACKEND_DIR para definirla.".into())
  }
}

fn detect_python(backend_dir: &Path) -> OsString {
  let mut options: Vec<PathBuf> = Vec::new();
  options.push(backend_dir.join(".venv/bin/python"));
  options.push(backend_dir.join(".venv/bin/python3"));
  options.push(backend_dir.join(".venv/Scripts/python.exe"));
  options.push(backend_dir.join(".venv/Scripts/python3.exe"));
  for candidate in options {
    if candidate.exists() {
      return candidate.into_os_string();
    }
  }
  OsString::from("python3")
}

fn wait_for_backend_ready() -> Result<(), String> {
  for _ in 0..40 {
    if TcpStream::connect("127.0.0.1:8000").is_ok() {
      return Ok(());
    }
    thread::sleep(Duration::from_millis(250));
  }
  Err("El backend FastAPI no respondió; revisa los logs.".into())
}

fn main() {
  let app = tauri::Builder::default()
    .manage(BackendProcess::default())
    .setup(|app| {
      let menu = Menu::new(app)?;
      let view_menu = Submenu::new(app, "Ver", true)?;
      let dev_item = MenuItem::with_id(
        app,
        "toggle-devtools",
        "Mostrar DevTools",
        true,
        Some("CmdOrCtrl+Alt+I"),
      )?;
      view_menu.append(&dev_item)?;
      menu.append(&view_menu)?;
      app.set_menu(menu)?;
      app.on_menu_event(|app, event| {
        if event.id().as_ref() == "toggle-devtools" {
          if let Some(win) = app.get_webview_window("main") {
            win.open_devtools();
          }
        }
      });
      match spawn_backend_process(app) {
        Ok(child) => {
          app
            .state::<BackendProcess>()
            .0
            .lock()
            .expect("backend lock poisoned")
            .replace(child);
        }
        Err(err) => {
          eprintln!("Backend FastAPI no iniciado automáticamente: {err}");
        }
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![import_csv, import_transfer_payload, ensure_backend, load_transfers, load_trades])
    .build(tauri::generate_context!())
    .expect("error al construir la aplicación Tauri");

  app.run(|app_handle, event| {
    if let RunEvent::Exit = event {
      if let Some(state) = app_handle.try_state::<BackendProcess>() {
        if let Some(mut child) = state.0.lock().expect("backend lock poisoned").take() {
          let _ = child.kill();
        }
      }
    }
  });
}
