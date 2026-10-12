"""Local web server for the review screen. Binds to 127.0.0.1 only (PRD §6)."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config
from .store import Store

WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
ALLOWED_HOSTS = {f"127.0.0.1:{config.PORT}", f"localhost:{config.PORT}", "127.0.0.1:5179", "localhost:5179"}


class Decision(BaseModel):
    keys: list[str]
    decision: str
    chosen: int | None = None


class Search(BaseModel):
    key: str
    q: str


class Apply(BaseModel):
    kinds: list[str] | None = None
    limit: int | None = None


def create_app() -> FastAPI:
    app = FastAPI(title="ytm2spotify", docs_url=None, redoc_url=None)
    store = Store(config.path(config.DB))

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        # DNS-rebinding guard: only answer to our own host names.
        if request.headers.get("host") not in ALLOWED_HOSTS:
            return PlainTextResponse("forbidden", status_code=403)
        # CSRF guard: writes need a custom header, which a foreign page cannot send without a preflight we never allow.
        if request.method != "GET" and request.headers.get("x-ytm2spotify") != "1":
            return PlainTextResponse("missing header", status_code=403)
        return await call_next(request)

    def spotify():
        from .adapters.spotify import SpotifyAdapter, SpotifyError
        try:
            return SpotifyAdapter(config.path(config.SPOTIFY_TOKEN))
        except SpotifyError as e:
            raise HTTPException(409, str(e))

    @app.get("/api/state")
    def state():
        recs = store.records()
        return {
            "records": recs,
            "unavailable_tracks": store.get_meta("ytm_unavailable_tracks", 0),
            "last_sync": store.get_meta("last_sync"),
            "cut": store.get_meta("cut", 0.9),
            "preserve_playlist": store.get_meta("preserve_playlist"),
        }

    @app.post("/api/decision")
    def decision(body: Decision):
        if body.decision not in ("pending", "accept", "skip", "preserve"):
            raise HTTPException(400, "bad decision")
        store.decide(body.keys, body.decision, body.chosen)
        return {"ok": True}

    @app.post("/api/cut")
    def cut(body: dict):
        store.set_meta("cut", float(body.get("cut", 0.9)))
        return {"ok": True}

    @app.post("/api/search")
    def search(body: Search):
        from .adapters.spotify import to_item
        from .matcher import score
        src = store.item(body.key)
        sp = spotify()
        found = [to_item(src.kind, o) for o in sp.search_raw(body.q, src.kind) if o]
        scored = sorted((score(src, f) for f in found), key=lambda s: -s.score)[:8]
        return {"cands": store.add_candidates(body.key, [s.to_dict() for s in scored])}

    @app.post("/api/apply")
    def apply(body: Apply):
        from .pipeline import apply as run
        return run(store, spotify(), body.kinds, body.limit)

    @app.post("/api/preserve")
    def preserve():
        from .adapters.ytmusic import YTMAuthError, YTMusicAdapter
        from .pipeline import preserve as run
        try:
            return run(store, YTMusicAdapter(config.path(config.YTM_AUTH)))
        except YTMAuthError as e:
            raise HTTPException(409, str(e))

    @app.get("/api/preserved.csv")
    def preserved_csv():
        from .pipeline import preserved_csv as csv
        return PlainTextResponse(csv(store), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=ytm2spotify-preserved.csv"})

    @app.exception_handler(Exception)
    async def errors(request: Request, exc: Exception):
        return JSONResponse({"detail": str(exc)}, status_code=500)

    if WEB_DIST.exists():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

        @app.get("/{path:path}")
        def index(path: str):
            f = WEB_DIST / path
            return FileResponse(f if path and f.is_file() else WEB_DIST / "index.html")

    return app
