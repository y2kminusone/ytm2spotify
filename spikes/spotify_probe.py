"""Spike R1/R2/R5: Spotify auth, library reads, search limit, and PUT /me/library for artists.

Throwaway code. Usage:
    python spikes/spotify_probe.py auth <CLIENT_ID>
    python spikes/spotify_probe.py probe
    python spikes/spotify_probe.py write-test artist "<artist name>"   [--keep]
    python spikes/spotify_probe.py write-test album  "<album name>"    [--keep]

write-test saves/follows the top search result, verifies it, then undoes it
unless it was already in your library or --keep is given.
"""

import base64
import hashlib
import json
import secrets
import sys
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import requests

OUT = Path(__file__).parent / "output"
OUT.mkdir(exist_ok=True)
TOKEN_FILE = OUT / "spotify_token.local.json"
REDIRECT = "http://127.0.0.1:8765/callback"
SCOPES = "user-library-read user-library-modify user-follow-read user-follow-modify"
API = "https://api.spotify.com/v1"


# ---- auth (PKCE) -------------------------------------------------------------

def cmd_auth(client_id: str) -> None:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode({
        "client_id": client_id, "response_type": "code", "redirect_uri": REDIRECT,
        "scope": SCOPES, "code_challenge_method": "S256", "code_challenge": challenge, "state": state,
    })

    result = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            result.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write("인증 완료. 터미널로 돌아가세요.".encode())

        def log_message(self, *a):
            pass

    print("Opening browser for Spotify login...")
    webbrowser.open(url)
    HTTPServer(("127.0.0.1", 8765), Handler).handle_request()

    if result.get("state") != state or "code" not in result:
        sys.exit(f"Auth failed: {result}")
    r = requests.post("https://accounts.spotify.com/api/token", data={
        "grant_type": "authorization_code", "code": result["code"], "redirect_uri": REDIRECT,
        "client_id": client_id, "code_verifier": verifier,
    })
    print("token exchange:", r.status_code)
    r.raise_for_status()
    tok = r.json() | {"client_id": client_id, "expires_at": time.time() + r.json()["expires_in"]}
    TOKEN_FILE.write_text(json.dumps(tok))
    print(f"R2 OK: token saved, scopes granted = {tok.get('scope')}")


def token() -> str:
    tok = json.loads(TOKEN_FILE.read_text())
    if time.time() > tok["expires_at"] - 60:
        r = requests.post("https://accounts.spotify.com/api/token", data={
            "grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": tok["client_id"],
        })
        r.raise_for_status()
        tok |= r.json() | {"expires_at": time.time() + r.json()["expires_in"]}
        TOKEN_FILE.write_text(json.dumps(tok))
    return tok["access_token"]


def call(method: str, path: str, **kw) -> requests.Response:
    r = requests.request(method, API + path, headers={"Authorization": f"Bearer {token()}"}, **kw)
    if r.status_code == 429:
        wait = int(r.headers.get("Retry-After", "5"))
        print(f"  429, sleeping {wait}s")
        time.sleep(wait)
        return call(method, path, **kw)
    return r


def show(label: str, r: requests.Response) -> None:
    body = r.text[:300].replace("\n", " ")
    print(f"  {label}: HTTP {r.status_code}  {body}")


# ---- probes ------------------------------------------------------------------

def cmd_probe() -> None:
    me = call("GET", "/me")
    print("me:", me.status_code, me.json().get("display_name") if me.ok else me.text)

    print("\n== library sizes (reads)")
    r = call("GET", "/me/albums", params={"limit": 1})
    print("  saved albums     :", r.json().get("total") if r.ok else r.text)
    r = call("GET", "/me/following", params={"type": "artist", "limit": 1})
    print("  followed artists :", r.json().get("artists", {}).get("total") if r.ok else r.text)
    r = call("GET", "/me/tracks", params={"limit": 1})
    print("  saved tracks     :", r.json().get("total") if r.ok else r.text)

    print("\n== R5: search limits")
    for limit in (10, 11, 50):
        r = call("GET", "/search", params={"q": "IU", "type": "artist", "limit": limit})
        n = len(r.json().get("artists", {}).get("items", [])) if r.ok else None
        print(f"  limit={limit:<3} -> HTTP {r.status_code}, items={n}")
    r = call("GET", "/search", params={"q": "album:Palette artist:IU", "type": "album", "limit": 3, "market": "from_token"})
    if r.ok:
        a = r.json()["albums"]["items"][0]
        print("  album fields available:", sorted(a.keys()))
    r = call("GET", "/search", params={"q": "track:Blueming artist:IU", "type": "track", "limit": 1, "market": "from_token"})
    if r.ok:
        t = r.json()["tracks"]["items"][0]
        print("  track has external_ids (ISRC):", t.get("external_ids"))


def cmd_write_test(kind: str, query: str, keep: bool) -> None:
    r = call("GET", "/search", params={"q": query, "type": kind, "limit": 1, "market": "from_token"})
    r.raise_for_status()
    item = r.json()[kind + "s"]["items"][0]
    uri = item["uri"]
    who = ", ".join(a["name"] for a in item.get("artists", [])) if kind == "album" else ""
    print(f"target: {item['name']} {who} -> {uri}")

    def contains() -> bool | None:
        r = call("GET", "/me/library/contains", params={"uris": uri})
        show("contains", r)
        return r.json()[0] if r.ok else None

    before = contains()
    show("PUT /me/library (query)", call("PUT", "/me/library", params={"uris": uri}))
    after = contains()
    if not after:
        print("  query-string form didn't stick; trying JSON body form")
        show("PUT /me/library (json)", call("PUT", "/me/library", json={"uris": [uri]}))
        after = contains()

    if kind == "artist":
        r = call("GET", "/me/following", params={"type": "artist", "limit": 50})
        ids = [a["id"] for a in r.json()["artists"]["items"]] if r.ok else []
        print(f"  visible in GET /me/following first page: {item['id'] in ids}")

    print(f"\nR1 result ({kind}): before={before} after={after}")
    if after and not before and not keep:
        show("undo DELETE /me/library", call("DELETE", "/me/library", params={"uris": uri}))
        contains()


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["auth"] and len(a) == 2:
        cmd_auth(a[1])
    elif a[:1] == ["probe"]:
        cmd_probe()
    elif a[:1] == ["write-test"] and len(a) >= 3:
        cmd_write_test(a[1], a[2], "--keep" in a)
    else:
        sys.exit(__doc__)
