"""Service-neutral library items. Adapters convert to these; the core never sees service JSON."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

Kind = Literal["album", "artist", "track"]
KINDS: tuple[Kind, ...] = ("album", "artist", "track")


@dataclass
class Item:
    service: str  # "ytm" | "spotify"
    kind: Kind
    id: str
    title: str  # album/track title, or artist name
    artists: list[str] = field(default_factory=list)
    album: str | None = None
    year: int | None = None
    duration_s: int | None = None
    track_count: int | None = None
    video_type: str | None = None  # YTM tracks: ATV / OMV / UGC / ...
    img: str | None = None
    uri: str | None = None  # Spotify URI

    @property
    def key(self) -> str:
        return f"{self.service}:{self.kind}:{self.id}"

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> Item:
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})
