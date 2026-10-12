"""YT Music via the unofficial ytmusicapi (ADR-001). Browser-header auth."""

from __future__ import annotations

from pathlib import Path

from ytmusicapi import YTMusic

from ..models import Item


def _thumb(ts) -> str | None:
    return ts[-1]["url"] if ts else None


def _year(v) -> int | None:
    try:
        return int(str(v)[:4])
    except (TypeError, ValueError):
        return None


class YTMAuthError(RuntimeError):
    """Copied browser cookies stop working after a while (found 2026-10-12, ~3h after copying)."""


class YTMusicAdapter:
    service = "ytm"

    def __init__(self, auth_file: Path):
        if not auth_file.exists():
            raise YTMAuthError("Not connected to YT Music yet")
        self.yt = YTMusic(str(auth_file))

    def check(self) -> None:
        """Raise YTMAuthError if the session is signed out. Library calls on a dead session
        don't fail loudly — they come back empty or as a 'Sign in' page."""
        try:
            self.yt.get_liked_songs(limit=1)
        except KeyError as e:
            if "Sign in" in str(e) or "signInEndpoint" in str(e):
                raise YTMAuthError("YT Music sign-in expired — copy the browser headers again") from e
            raise

    def albums(self) -> list[Item]:
        return [
            Item("ytm", "album", a["browseId"], a["title"], [x["name"] for x in a.get("artists") or []],
                 year=_year(a.get("year")), img=_thumb(a.get("thumbnails")))
            for a in self.yt.get_library_albums(limit=None)
            if a.get("browseId")
        ]

    def artists(self) -> list[Item]:
        return [
            Item("ytm", "artist", a["browseId"], a["artist"], img=_thumb(a.get("thumbnails")))
            for a in self.yt.get_library_subscriptions(limit=None)
            if a.get("browseId")
        ]

    def liked_tracks(self) -> tuple[list[Item], int]:
        """Liked songs, de-duplicated by videoId (Spike R3). Also returns the playlist's own count,
        which includes deleted/private videos that can never be listed."""
        res = self.yt.get_liked_songs(limit=None)
        out, seen = [], set()
        for t in res.get("tracks", []):
            vid = t.get("videoId")
            if not vid or vid in seen:
                continue
            seen.add(vid)
            out.append(Item(
                "ytm", "track", vid, t["title"], [x["name"] for x in t.get("artists") or []],
                album=(t.get("album") or {}).get("name"), duration_s=t.get("duration_seconds"),
                video_type=t.get("videoType"), img=_thumb(t.get("thumbnails")),
            ))
        return out, int(res.get("trackCount") or len(out))

    def create_playlist(self, title: str, description: str, video_ids: list[str]) -> str:
        res = self.yt.create_playlist(title, description, privacy_status="PRIVATE", video_ids=video_ids)
        if isinstance(res, str):
            return res
        raise RuntimeError(f"YT Music refused to create the playlist: {res}")
