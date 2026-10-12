"""Spotify Web API (2026 dev-mode rules, Spike R1/R2/R5).

- PKCE, the user's own Client ID (BYOK)
- saving and following both go through PUT /me/library?uris=… (max 40 per call)
- search limit is 10; market must be explicit
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import threading
import time
import urllib.parse
from pathlib import Path

import requests

from ..config import MARKET, PORT, protect
from ..models import Item

API = "https://api.spotify.com/v1"
ACCOUNTS = "https://accounts.spotify.com"
REDIRECT = f"http://127.0.0.1:{PORT}/callback"
SCOPES = "user-library-read user-library-modify user-follow-read user-follow-modify"
BATCH = 40


class SpotifyError(RuntimeError):
    pass


def _img(images) -> str | None:
    return images[0]["url"] if images else None


def _year(date: str | None) -> int | None:
    try:
        return int((date or "")[:4])
    except ValueError:
        return None


def to_item(kind: str, o: dict) -> Item:
    if kind == "album":
        return Item("spotify", "album", o["id"], o["name"], [a["name"] for a in o.get("artists", [])],
                    year=_year(o.get("release_date")), track_count=o.get("total_tracks"),
                    img=_img(o.get("images")), uri=o["uri"])
    if kind == "artist":
        return Item("spotify", "artist", o["id"], o["name"], img=_img(o.get("images")), uri=o["uri"])
    alb = o.get("album") or {}
    return Item("spotify", "track", o["id"], o["name"], [a["name"] for a in o.get("artists", [])],
                album=alb.get("name"), year=_year(alb.get("release_date")),
                duration_s=round(o["duration_ms"] / 1000) if o.get("duration_ms") else None,
                img=_img(alb.get("images")), uri=o["uri"])


# ---------------------------------------------------------------- auth (PKCE)

def auth_url(client_id: str) -> tuple[str, str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    url = f"{ACCOUNTS}/authorize?" + urllib.parse.urlencode({
        "client_id": client_id, "response_type": "code", "redirect_uri": REDIRECT, "scope": SCOPES,
        "code_challenge_method": "S256", "code_challenge": challenge, "state": state,
    })
    return url, verifier, state


def exchange_code(client_id: str, code: str, verifier: str, token_file: Path) -> None:
    r = requests.post(f"{ACCOUNTS}/api/token", data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
        "client_id": client_id, "code_verifier": verifier,
    }, timeout=20)
    if not r.ok:
        raise SpotifyError(f"token exchange failed: {r.status_code} {r.text[:200]}")
    tok = r.json() | {"client_id": client_id, "expires_at": time.time() + r.json()["expires_in"]}
    token_file.write_text(json.dumps(tok))
    protect(token_file)


# ---------------------------------------------------------------- client

class SpotifyAdapter:
    service = "spotify"

    def __init__(self, token_file: Path, market: str = MARKET):
        if not token_file.exists():
            raise SpotifyError("Not connected to Spotify yet")
        self.token_file = token_file
        self.market = market
        self.session = requests.Session()
        self._lock = threading.Lock()

    def _token(self) -> str:
        with self._lock:
            tok = json.loads(self.token_file.read_text())
            if time.time() > tok["expires_at"] - 60:
                r = requests.post(f"{ACCOUNTS}/api/token", data={
                    "grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": tok["client_id"],
                }, timeout=20)
                if not r.ok:
                    raise SpotifyError(f"token refresh failed: {r.status_code} — reconnect Spotify")
                tok |= r.json() | {"expires_at": time.time() + r.json()["expires_in"]}
                self.token_file.write_text(json.dumps(tok))
                protect(self.token_file)
            return tok["access_token"]

    def _call(self, method: str, path: str, **kw) -> requests.Response:
        for attempt in range(6):
            r = self.session.request(method, API + path, headers={"Authorization": f"Bearer {self._token()}"}, timeout=30, **kw)
            if r.status_code == 429:
                time.sleep(min(int(r.headers.get("Retry-After", "2")) + 1, 60))
                continue
            if r.status_code >= 500 and attempt < 3:
                time.sleep(1 + attempt)
                continue
            return r
        return r

    def _pages(self, path: str, key: str | None = None, cursor: bool = False):
        params = {"limit": 50}
        while True:
            r = self._call("GET", path, params=params)
            if not r.ok:
                raise SpotifyError(f"GET {path}: {r.status_code} {r.text[:200]}")
            body = r.json()
            page = body[key] if key else body
            yield from page["items"]
            if cursor:
                after = (page.get("cursors") or {}).get("after")
                if not after:
                    return
                params = {"limit": 50, "after": after}
            else:
                if not page.get("next"):
                    return
                params = {"limit": 50, "offset": page["offset"] + page["limit"]}

    # library
    def albums(self) -> list[Item]:
        return [to_item("album", x["album"]) for x in self._pages("/me/albums")]

    def artists(self) -> list[Item]:
        return [to_item("artist", x) for x in self._pages("/me/following?type=artist", key="artists", cursor=True)]

    def tracks(self) -> list[Item]:
        return [to_item("track", x["track"]) for x in self._pages("/me/tracks") if x.get("track")]

    # search
    def search_raw(self, q: str, kind: str) -> list[dict]:
        r = self._call("GET", "/search", params={"q": q, "type": kind, "limit": 10, "market": self.market})
        if not r.ok:
            raise SpotifyError(f"search: {r.status_code} {r.text[:200]}")
        return r.json()[kind + "s"]["items"]

    # write
    def save(self, uris: list[str]) -> list[tuple[list[str], str | None]]:
        """PUT /me/library in batches of 40. Returns (batch, error-or-None) per batch."""
        out = []
        for i in range(0, len(uris), BATCH):
            batch = uris[i:i + BATCH]
            r = self._call("PUT", "/me/library", params={"uris": ",".join(batch)})
            out.append((batch, None if r.ok else f"{r.status_code} {r.text[:200]}"))
        return out

    def remove(self, uris: list[str]) -> None:
        for i in range(0, len(uris), BATCH):
            self._call("DELETE", "/me/library", params={"uris": ",".join(uris[i:i + BATCH])})
