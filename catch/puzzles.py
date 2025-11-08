"""Runtime helpers for selecting and presenting puzzles."""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

from PIL import Image, ImageOps, ImageTk

try:  # Pillow < 9.1 compatibility
    RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:  # pragma: no cover - depends on pillow version
    RESAMPLE = Image.LANCZOS

from .models import EmojiPuzzle, FilterPuzzle, PicturePuzzle, SoundPuzzle
from .storage import DATA_DIR, resolve_media_path

try:
    import pygame
except Exception:  # pragma: no cover - pygame not available in tests
    pygame = None


@dataclass
class PuzzleSelection:
    category: str
    payload: object


class PuzzleDeck:
    """Maintains random order of puzzles without repetition until all are used."""

    def __init__(self, puzzles: Dict[str, List]):
        self._original = puzzles
        self._unused: Dict[str, List] = {key: list(value) for key, value in puzzles.items()}

    def next_for(self, category: str) -> Optional[PuzzleSelection]:
        options = self._unused.setdefault(category, [])
        if not options:
            # Reset deck when empty
            options.extend(self._original.get(category, []))
        if not options:
            return None
        choice = random.choice(options)
        options.remove(choice)
        return PuzzleSelection(category=category, payload=choice)


def load_image(relative_path: str, size: Optional[Sequence[int]] = None) -> ImageTk.PhotoImage:
    path = resolve_media_path(relative_path)
    if not path or not path.exists():
        raise FileNotFoundError(f"Image not found: {relative_path}")
    image = Image.open(path)
    if size:
        image.thumbnail(size, RESAMPLE)
    return ImageTk.PhotoImage(image)


def load_random_snippet(
    relative_path: str,
    size: Optional[Sequence[int]] = None,
    zoom_range: Sequence[float] = (0.35, 0.6),
) -> ImageTk.PhotoImage:
    path = resolve_media_path(relative_path)
    if not path or not path.exists():
        raise FileNotFoundError(f"Image not found: {relative_path}")
    with Image.open(path) as image:
        width, height = image.size
        if width < 40 or height < 40:
            cropped = image.copy()
        else:
            min_zoom, max_zoom = zoom_range
            zoom = random.uniform(min_zoom, max_zoom)
            crop_w = max(40, int(width * zoom))
            crop_h = max(40, int(height * zoom))
            max_x = max(0, width - crop_w)
            max_y = max(0, height - crop_h)
            left = random.randint(0, max_x) if max_x else 0
            top = random.randint(0, max_y) if max_y else 0
            right = left + crop_w
            bottom = top + crop_h
            cropped = image.crop((left, top, right, bottom))
        if size:
            cropped = ImageOps.fit(cropped, size, RESAMPLE)
        return ImageTk.PhotoImage(cropped)


class SoundPlayer:
    def __init__(self) -> None:
        self._ready = False
        if pygame:
            try:
                pygame.mixer.init()
                self._ready = True
            except Exception:
                self._ready = False

    def play(self, relative_path: str) -> None:
        if not pygame or not self._ready:
            raise RuntimeError("pygame.mixer konnte nicht initialisiert werden.")
        media_path = resolve_media_path(relative_path)
        if not media_path or not media_path.exists():
            raise FileNotFoundError(f"Audiodatei nicht gefunden: {relative_path}")
        pygame.mixer.music.load(media_path)
        pygame.mixer.music.play()

    def stop(self) -> None:
        if pygame and self._ready:
            pygame.mixer.music.stop()
