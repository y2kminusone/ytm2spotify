"""Where ytm2spotify keeps its files. Everything stays on this machine."""

import os
import platform
from pathlib import Path

APP = "ytm2spotify"
PORT = 8765
MARKET = os.environ.get("YTM2SPOTIFY_MARKET", "KR")  # search with market=from_token needs an extra scope (spike R2)

YTM_AUTH = "ytm_browser.json"
SPOTIFY_TOKEN = "spotify_token.json"
DB = "ytm2spotify.db"


def data_dir() -> Path:
    if override := os.environ.get("YTM2SPOTIFY_HOME"):
        base = Path(override)
    elif platform.system() == "Windows":
        base = Path(os.environ.get("APPDATA", Path.home())) / APP
    elif platform.system() == "Darwin":
        base = Path.home() / "Library" / "Application Support" / APP
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / APP
    base.mkdir(parents=True, exist_ok=True)
    return base


def path(name: str) -> Path:
    return data_dir() / name


def protect(p: Path) -> None:
    """Credentials are owner-readable only."""
    try:
        p.chmod(0o600)
    except OSError:
        pass
