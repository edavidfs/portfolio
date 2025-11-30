"""
Configuración centralizada de logging para backend (FastAPI, importer, precios).
Escribe en la ruta indicada por BACKEND_LOG_PATH (env/.env) o backend-fastapi.log.
"""
import logging
import os
import sys
from pathlib import Path

APP_IDENTIFIER = "com.portfolio.desktop"

def _user_data_dir(appname: str) -> Path:
  try:
    from platformdirs import user_data_dir
    return Path(user_data_dir(appname, False))
  except Exception:
    home = Path.home()
    if os.name == "nt":
      base = Path(os.environ.get("APPDATA", home))
      return base / appname
    if sys.platform == "darwin":
      return home / "Library" / "Application Support" / appname
    return home / ".local" / "share" / appname


def log_path_from_env() -> Path:
  env_path = os.environ.get("BACKEND_LOG_PATH")
  if env_path:
    return Path(env_path).expanduser()
  # Por defecto, usa el directorio de datos del usuario
  base = _user_data_dir(APP_IDENTIFIER)
  base.mkdir(parents=True, exist_ok=True)
  return base / "backend-fastapi.log"


# LOG_PATH se recalcula cada vez que se configure el logging para respetar .env actualizado.
LOG_PATH = log_path_from_env()


def configure_root_logging():
  global LOG_PATH
  LOG_PATH = log_path_from_env()
  LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
  if not logging.getLogger().handlers:
    logging.basicConfig(
      level=logging.INFO,
      format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
      filename=str(LOG_PATH),
      filemode="a"
    )
  return LOG_PATH


def get_file_handler():
  path = log_path_from_env()
  path.parent.mkdir(parents=True, exist_ok=True)
  handler = logging.FileHandler(path, encoding="utf-8")
  handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s"))
  return handler
