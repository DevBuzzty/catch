"""Persistence helpers for the Catch board game."""
from __future__ import annotations

import json
import random
import shutil
import uuid
from pathlib import Path
from typing import Iterable, List, Optional

from PIL import Image, ImageOps

try:  # Pillow < 9.1 compatibility
    RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:  # pragma: no cover - depends on pillow version
    RESAMPLE = Image.LANCZOS

from .models import AIPuzzle, EmojiPuzzle, GameDocument, PicturePuzzle, SoundPuzzle, TileData, default_document


DATA_DIR = Path("data")
MEDIA_DIR = DATA_DIR / "media"
BOARD_BG_DIR = MEDIA_DIR / "board"
PICTURE_SNIPPETS_DIR = MEDIA_DIR / "picture" / "snippets"
PICTURE_FULL_DIR = MEDIA_DIR / "picture" / "full"
SOUND_DIR = MEDIA_DIR / "sound"
AI_DIR = MEDIA_DIR / "ai"
AI_REAL_DIR = AI_DIR / "real"
AI_FAKE_DIR = AI_DIR / "generated"
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
        AI_DIR,
        AI_REAL_DIR,
        AI_FAKE_DIR,
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


def _generate_snippet_from_full(full_rel: str) -> Optional[str]:
    full_path = DATA_DIR / full_rel
    if not full_path.exists():
        return None
    with Image.open(full_path) as image:
        width, height = image.size
        if width < 40 or height < 40:
            return None
        min_zoom, max_zoom = 0.35, 0.6
        zoom = random.uniform(min_zoom, max_zoom)
        crop_w = max(40, int(width * zoom))
        crop_h = max(40, int(height * zoom))
        max_x = max(0, width - crop_w)
        max_y = max(0, height - crop_h)
        left = random.randint(0, max_x) if max_x else 0
        top = random.randint(0, max_y) if max_y else 0
        right = left + crop_w
        bottom = top + crop_h
        snippet = image.crop((left, top, right, bottom))
        snippet = ImageOps.fit(snippet, (512, 512), RESAMPLE)
    identifier = uuid.uuid4().hex
    dest = PICTURE_SNIPPETS_DIR / f"{identifier}{full_path.suffix or '.png'}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    snippet.save(dest)
    return make_relative(dest)


def add_picture_puzzle(document: GameDocument, answer: str, full: Path) -> PicturePuzzle:
    full_rel = copy_media(full, PICTURE_FULL_DIR)
    snippet_rel = _generate_snippet_from_full(full_rel)
    puzzle = PicturePuzzle(answer=answer, full_path=full_rel, id=uuid.uuid4().hex, snippet_path=snippet_rel)
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


def add_ai_puzzle(document: GameDocument, real_image: Path, ai_image: Path) -> AIPuzzle:
    real_rel = copy_media(real_image, AI_REAL_DIR)
    ai_rel = copy_media(ai_image, AI_FAKE_DIR)
    puzzle = AIPuzzle(real_path=real_rel, ai_path=ai_rel, id=uuid.uuid4().hex)
    document.puzzles.setdefault("ai", []).append(puzzle)
    return puzzle


def set_tile_background(tile: TileData, image_path: Path) -> None:
    rel_path = copy_media(image_path, BOARD_BG_DIR)
    tile.background = rel_path


def add_board_backgrounds(images: Iterable[Path]) -> List[str]:
    """Copy multiple board background images into storage."""

    stored: List[str] = []
    for image in images:
        rel_path = copy_media(image, BOARD_BG_DIR)
        stored.append(rel_path)
    return stored


def export_template(document: GameDocument) -> None:
    ensure_directories()
    save_document(document, TEMPLATE_FILE)
