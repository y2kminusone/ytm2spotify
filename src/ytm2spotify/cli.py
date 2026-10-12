"""ytm2spotify command line.

  ytm2spotify import-auth <dir>   reuse spike credentials (ytm_browser.local.json, spotify_token.local.json)
  ytm2spotify ytm-headers <file> connect YT Music from copied browser headers
  ytm2spotify sync                read both libraries
  ytm2spotify match               match YT Music items to Spotify (resumable, cached)
  ytm2spotify serve               open the review screen
  ytm2spotify status              counts by status/decision
  ytm2spotify undo                remove everything ytm2spotify saved to Spotify
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

from . import config
from .store import Store


def _store() -> Store:
    return Store(config.path(config.DB))


def _spotify():
    from .adapters.spotify import SpotifyAdapter
    return SpotifyAdapter(config.path(config.SPOTIFY_TOKEN))


def _ytm():
    from .adapters.ytmusic import YTMusicAdapter
    return YTMusicAdapter(config.path(config.YTM_AUTH))


def cmd_ytm_headers(args) -> None:
    """Paste fresh browser request headers (from the clipboard file) → new YT Music auth."""
    from ytmusicapi import setup
    raw = Path(args.file).read_text(encoding="utf-8")
    setup(filepath=str(config.path(config.YTM_AUTH)), headers_raw=raw)
    config.protect(config.path(config.YTM_AUTH))
    Path(args.file).unlink()
    _ytm().check()
    print("YT Music connected (raw headers file deleted)")


def cmd_import_auth(args) -> None:
    src = Path(args.dir)
    for a, b in [("ytm_browser.local.json", config.YTM_AUTH), ("spotify_token.local.json", config.SPOTIFY_TOKEN)]:
        shutil.copy(src / a, config.path(b))
        config.protect(config.path(b))
        print(f"imported {a} → {config.path(b)}")


def cmd_sync(args) -> None:
    from .pipeline import sync
    print(json.dumps(sync(_store(), _ytm(), _spotify()), indent=2))


def cmd_match(args) -> None:
    from .pipeline import match_all
    print(json.dumps(match_all(_store(), _spotify(), workers=args.workers), indent=2, ensure_ascii=False))


def cmd_status(args) -> None:
    recs = _store().records()
    for kind in ("album", "artist", "track"):
        rs = [r for r in recs if r["kind"] == kind]
        print(f"{kind:7} {len(rs):5}  status={dict(Counter(r['status'] for r in rs))}  decision={dict(Counter(r['decision'] for r in rs))}"
              f"  applied={sum(r['apply_status'] == 'done' for r in rs)}")


def cmd_serve(args) -> None:
    import uvicorn
    import webbrowser
    from .server import create_app
    url = f"http://127.0.0.1:{config.PORT}"
    if not args.no_browser:
        webbrowser.open(url)
    print(f"ytm2spotify running at {url}  (Ctrl+C to stop)")
    uvicorn.run(create_app(), host="127.0.0.1", port=config.PORT, log_level="warning")


def cmd_undo(args) -> None:
    from .pipeline import undo
    if input("Remove everything ytm2spotify saved to Spotify? type 'yes': ") == "yes":
        print(f"removed {undo(_store(), _spotify())} items")


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="ytm2spotify")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("import-auth"); a.add_argument("dir"); a.set_defaults(f=cmd_import_auth)
    y = sub.add_parser("ytm-headers"); y.add_argument("file"); y.set_defaults(f=cmd_ytm_headers)
    sub.add_parser("sync").set_defaults(f=cmd_sync)
    m = sub.add_parser("match"); m.add_argument("--workers", type=int, default=4); m.set_defaults(f=cmd_match)
    sub.add_parser("status").set_defaults(f=cmd_status)
    s = sub.add_parser("serve"); s.add_argument("--no-browser", action="store_true"); s.set_defaults(f=cmd_serve)
    sub.add_parser("undo").set_defaults(f=cmd_undo)
    args = p.parse_args(argv)
    from .adapters.ytmusic import YTMAuthError
    from .adapters.spotify import SpotifyError
    try:
        args.f(args)
    except KeyboardInterrupt:
        sys.exit(130)
    except (YTMAuthError, SpotifyError) as e:
        sys.exit(f"error: {e}")
