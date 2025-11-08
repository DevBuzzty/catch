"""Tkinter canvas that renders the game board."""
from __future__ import annotations

import tkinter as tk
from dataclasses import dataclass
from typing import Dict, Optional

from PIL import Image, ImageTk

from ..models import BoardLayout
from ..storage import resolve_media_path


@dataclass
class TileGeometry:
    x: int
    y: int
    width: int
    height: int


class BoardCanvas(tk.Canvas):
    def __init__(self, master: tk.Misc, board: BoardLayout, tile_size: int = 120, **kwargs) -> None:
        width = board.cols * tile_size
        height = board.rows * tile_size
        super().__init__(master, width=width, height=height, **kwargs)
        self.board = board
        self.tile_size = tile_size
        self._images: Dict[int, ImageTk.PhotoImage] = {}
        self._token_items: Dict[str, int] = {}
        self.selected_index: Optional[int] = None
        self.bind("<Button-1>", self._on_click)
        self.redraw()

    def _tile_geometry(self, index: int) -> TileGeometry:
        row = index // self.board.cols
        col = index % self.board.cols
        return TileGeometry(x=col * self.tile_size, y=row * self.tile_size, width=self.tile_size, height=self.tile_size)

    def redraw(self) -> None:
        self.delete("all")
        self._images.clear()
        for tile in self.board.tiles:
            geom = self._tile_geometry(tile.index)
            x0, y0 = geom.x, geom.y
            x1, y1 = x0 + geom.width, y0 + geom.height
            color = "#ffffff"
            if tile.category == "start":
                color = "#2a9d8f"
            elif tile.category == "finish":
                color = "#ffb703"
            elif tile.category == "picture":
                color = "#d9ed92"
            elif tile.category == "sound":
                color = "#fec89a"
            elif tile.category == "emoji":
                color = "#cdb4db"
            elif tile.category == "filter":
                color = "#bde0fe"
            self.create_rectangle(x0, y0, x1, y1, fill=color, outline="#264653", width=3, tags=(f"tile-{tile.index}", "tile"))
            if tile.background:
                path = resolve_media_path(tile.background)
                if path and path.exists():
                    image = Image.open(path)
                    image = image.resize((geom.width, geom.height))
                    photo = ImageTk.PhotoImage(image)
                    self._images[tile.index] = photo
                    self.create_image(x0, y0, image=photo, anchor="nw")
            label = tile.category.upper()
            if tile.category in {"start", "finish"}:
                label = tile.category.title()
            self.create_text(
                x0 + geom.width / 2,
                y0 + geom.height - 12,
                text=label,
                font=("Helvetica", 10, "bold"),
                fill="#1d3557",
            )
            if self.selected_index == tile.index:
                self.create_rectangle(x0 + 4, y0 + 4, x1 - 4, y1 - 4, outline="#1d3557", width=3, dash=(4, 2))

    def set_selected(self, index: Optional[int]) -> None:
        self.selected_index = index
        self.redraw()

    def _on_click(self, event: tk.Event) -> None:
        col = int(event.x // self.tile_size)
        row = int(event.y // self.tile_size)
        index = row * self.board.cols + col
        if 0 <= index < len(self.board.tiles):
            self.set_selected(index)
            self.event_generate("<<TileSelected>>", data=str(index))

    def update_token(self, token_id: str, tile_index: int, color: str) -> None:
        geom = self._tile_geometry(tile_index)
        radius = self.tile_size // 6
        cx = geom.x + self.tile_size // 2
        cy = geom.y + self.tile_size // 2
        coords = (cx - radius, cy - radius, cx + radius, cy + radius)
        if token_id in self._token_items:
            self.coords(self._token_items[token_id], *coords)
        else:
            item = self.create_oval(*coords, fill=color, outline="#1d3557", width=2)
            self._token_items[token_id] = item

    def remove_token(self, token_id: str) -> None:
        item = self._token_items.pop(token_id, None)
        if item:
            self.delete(item)

    def clear_tokens(self) -> None:
        for item in self._token_items.values():
            self.delete(item)
        self._token_items.clear()
