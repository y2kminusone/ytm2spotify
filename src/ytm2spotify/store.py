"""SQLite state (ADR-002, DESIGN §2.3). Machine judgment, human decision and apply result live in
separate columns so re-matching never overwrites what the user decided."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

from .models import Item

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
  key TEXT PRIMARY KEY, service TEXT, kind TEXT, payload TEXT,
  first_seen REAL, last_seen REAL, removed INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS matches (
  source_key TEXT PRIMARY KEY REFERENCES items(key),
  match_status TEXT, candidates TEXT, variant TEXT, parsed_artist TEXT, matcher_version INTEGER,
  decision TEXT DEFAULT 'pending', chosen INTEGER DEFAULT 0,
  apply_status TEXT DEFAULT 'none', apply_error TEXT, applied_uri TEXT, applied_at REAL,
  updated_at REAL
);
CREATE TABLE IF NOT EXISTS search_cache (q TEXT PRIMARY KEY, response TEXT, fetched_at REAL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""


class Store:
    def __init__(self, path: Path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self.lock = threading.Lock()

    # ---- meta
    def get_meta(self, k: str, default=None):
        row = self.db.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
        return json.loads(row["v"]) if row else default

    def set_meta(self, k: str, v) -> None:
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (k, json.dumps(v)))

    # ---- library snapshots (DESIGN §3.1: keep decisions, mark removed, report what's new)
    def sync_items(self, service: str, items: list[Item]) -> dict:
        now = time.time()
        keys = {it.key for it in items}
        with self.lock, self.db:
            old = {r["key"] for r in self.db.execute("SELECT key FROM items WHERE service=? AND removed=0", (service,))}
            for it in items:
                self.db.execute(
                    """INSERT INTO items (key, service, kind, payload, first_seen, last_seen, removed)
                       VALUES (?,?,?,?,?,?,0)
                       ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, last_seen=excluded.last_seen, removed=0""",
                    (it.key, service, it.kind, json.dumps(it.to_dict(), ensure_ascii=False), now, now),
                )
            gone = old - keys
            self.db.executemany("UPDATE items SET removed=1 WHERE key=?", [(k,) for k in gone])
        return {"total": len(items), "new": len(keys - old), "removed": len(gone)}

    def items(self, service: str, kind: str | None = None) -> list[Item]:
        sql = "SELECT payload FROM items WHERE service=? AND removed=0" + (" AND kind=?" if kind else "")
        args = (service, kind) if kind else (service,)
        return [Item.from_dict(json.loads(r["payload"])) for r in self.db.execute(sql, args)]

    # ---- matches
    def unmatched_keys(self, version: int) -> list[str]:
        """YTM items with no match yet, or still pending under an older matcher."""
        rows = self.db.execute(
            """SELECT i.key FROM items i LEFT JOIN matches m ON m.source_key=i.key
               WHERE i.service='ytm' AND i.removed=0
                 AND (m.source_key IS NULL OR (m.decision='pending' AND m.matcher_version < ?))""",
            (version,),
        )
        return [r["key"] for r in rows]

    def item(self, key: str) -> Item:
        row = self.db.execute("SELECT payload FROM items WHERE key=?", (key,)).fetchone()
        return Item.from_dict(json.loads(row["payload"]))

    def save_match(self, key: str, status: str, candidates: list[dict], variant, parsed_artist, version: int, decision: str):
        with self.lock, self.db:
            self.db.execute(
                """INSERT INTO matches (source_key, match_status, candidates, variant, parsed_artist, matcher_version,
                                        decision, chosen, updated_at)
                   VALUES (?,?,?,?,?,?,?,0,?)
                   ON CONFLICT(source_key) DO UPDATE SET
                     match_status=excluded.match_status, candidates=excluded.candidates, variant=excluded.variant,
                     parsed_artist=excluded.parsed_artist, matcher_version=excluded.matcher_version,
                     updated_at=excluded.updated_at,
                     -- never overwrite a human decision
                     decision=CASE WHEN matches.decision='pending' THEN excluded.decision ELSE matches.decision END""",
                (key, status, json.dumps(candidates, ensure_ascii=False), variant, parsed_artist, version, decision, time.time()),
            )

    def records(self) -> list[dict]:
        rows = self.db.execute(
            """SELECT i.key, i.kind, i.payload, m.* FROM items i JOIN matches m ON m.source_key=i.key
               WHERE i.service='ytm' AND i.removed=0"""
        )
        out = []
        for r in rows:
            out.append({
                "key": r["key"], "kind": r["kind"], "src": json.loads(r["payload"]),
                "status": r["match_status"], "cands": json.loads(r["candidates"] or "[]"),
                "variant": r["variant"], "parsed_artist": r["parsed_artist"],
                "decision": r["decision"], "chosen": r["chosen"],
                "apply_status": r["apply_status"], "apply_error": r["apply_error"],
            })
        return out

    def decide(self, keys: list[str], decision: str, chosen: int | None = None) -> None:
        with self.lock, self.db:
            for k in keys:
                if chosen is None:
                    self.db.execute("UPDATE matches SET decision=?, updated_at=? WHERE source_key=?", (decision, time.time(), k))
                else:
                    self.db.execute("UPDATE matches SET decision=?, chosen=?, updated_at=? WHERE source_key=?",
                                    (decision, chosen, time.time(), k))

    def add_candidates(self, key: str, cands: list[dict]) -> list[dict]:
        row = self.db.execute("SELECT candidates FROM matches WHERE source_key=?", (key,)).fetchone()
        merged = json.loads(row["candidates"] or "[]")
        ids = {c["item"]["id"] for c in merged}
        merged += [c for c in cands if c["item"]["id"] not in ids]
        with self.lock, self.db:
            self.db.execute("UPDATE matches SET candidates=? WHERE source_key=?", (json.dumps(merged, ensure_ascii=False), key))
        return merged

    def mark_applied(self, key: str, ok: bool, uri: str | None, error: str | None = None) -> None:
        with self.lock, self.db:
            self.db.execute(
                "UPDATE matches SET apply_status=?, apply_error=?, applied_uri=?, applied_at=? WHERE source_key=?",
                ("done" if ok else "failed", error, uri if ok else None, time.time(), key),
            )

    def applied_uris(self) -> list[str]:
        return [r["applied_uri"] for r in self.db.execute("SELECT applied_uri FROM matches WHERE apply_status='done'")]

    # ---- search cache
    def cached(self, q: str):
        row = self.db.execute("SELECT response FROM search_cache WHERE q=?", (q,)).fetchone()
        return json.loads(row["response"]) if row else None

    def cache(self, q: str, response) -> None:
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO search_cache VALUES (?,?,?)", (q, json.dumps(response, ensure_ascii=False), time.time()))
