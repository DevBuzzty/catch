"""Persistence helpers for the Catch board game."""
from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Optional

from .models import (
    EmojiPuzzle,
    FilterPuzzle,
    GameDocument,
    PicturePuzzle,
    SoundPuzzle,
    TileData,
    default_document,
)


DATA_DIR = Path("data")
MEDIA_DIR = DATA_DIR / "media"
BOARD_BG_DIR = MEDIA_DIR / "board"
PICTURE_SNIPPETS_DIR = MEDIA_DIR / "picture" / "snippets"
PICTURE_FULL_DIR = MEDIA_DIR / "picture" / "full"
SOUND_DIR = MEDIA_DIR / "sound"
FILTER_DIR = MEDIA_DIR / "filter"
EMOJI_DIR = MEDIA_DIR / "emoji"
DEFAULT_SAVE = DATA_DIR / "game_state.json"
TEMPLATE_FILE = DATA_DIR / "template.json"


def ensure_directories() -> None:
    for directory in [
        DATA_DIR,
        MEDIA_DIR,
        BOARD_BG_DIR,
        PICTURE_SNIPPETS_DIR,
        PICTURE_FULL_DIR,
        SOUND_DIR,
        FILTER_DIR,
        EMOJI_DIR,
    ]:
        directory.mkdir(parents=True, exist_ok=True)


def resolve_media_path(relative_path: Optional[str]) -> Optional[Path]:
    if not relative_path:
        return None
    return DATA_DIR / relative_path


def make_relative(path: Path) -> str:
    return str(path.relative_to(DATA_DIR))


def load_document(path: Optional[Path] = None) -> GameDocument:
    ensure_directories()
    target = path or (DEFAULT_SAVE if DEFAULT_SAVE.exists() else TEMPLATE_FILE)
    if target and target.exists():
        with target.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)
        return GameDocument.from_dict(raw)
    document = default_document()
    save_document(document, TEMPLATE_FILE)
    return document


def save_document(document: GameDocument, path: Optional[Path] = None) -> None:
    ensure_directories()
    target = path or DEFAULT_SAVE
    payload = document.to_dict()
    with target.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)


def copy_media(src: Path, dest_dir: Path) -> str:
    ensure_directories()
    dest_dir.mkdir(parents=True, exist_ok=True)
    extension = src.suffix
    identifier = uuid.uuid4().hex
    destination = dest_dir / f"{identifier}{extension}"
    shutil.copy(src, destination)
    return make_relative(destination)


def add_picture_puzzle(document: GameDocument, answer: str, snippet: Path, full: Path) -> PicturePuzzle:
    snippet_rel = copy_media(snippet, PICTURE_SNIPPETS_DIR)
    full_rel = copy_media(full, PICTURE_FULL_DIR)
    puzzle = PicturePuzzle(answer=answer, snippet_path=snippet_rel, full_path=full_rel, id=uuid.uuid4().hex)
    document.puzzles.setdefault("picture", []).append(puzzle)
    return puzzle


def add_sound_puzzle(document: GameDocument, answer: str, audio: Path) -> SoundPuzzle:
    audio_rel = copy_media(audio, SOUND_DIR)
    puzzle = SoundPuzzle(answer=answer, audio_path=audio_rel, id=uuid.uuid4().hex)
    document.puzzles.setdefault("sound", []).append(puzzle)
    return puzzle


def add_emoji_puzzle(document: GameDocument, prompt: str, answer: str) -> EmojiPuzzle:
    puzzle = EmojiPuzzle(prompt=prompt, answer=answer, id=uuid.uuid4().hex)
    document.puzzles.setdefault("emoji", []).append(puzzle)
    return puzzle


def add_filter_puzzle(document: GameDocument, answer: str, image: Path) -> FilterPuzzle:
    image_rel = copy_media(image, FILTER_DIR)
    puzzle = FilterPuzzle(answer=answer, image_path=image_rel, id=uuid.uuid4().hex)
    document.puzzles.setdefault("filter", []).append(puzzle)
    return puzzle


def set_tile_background(tile: TileData, image_path: Path) -> None:
    rel_path = copy_media(image_path, BOARD_BG_DIR)
    tile.background = rel_path


def export_template(document: GameDocument) -> None:
    ensure_directories()
    save_document(document, TEMPLATE_FILE)
