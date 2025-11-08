"""Tkinter canvas that renders the game board."""
from __future__ import annotations

import tkinter as tk
from dataclasses import dataclass
from typing import Dict, List, Optional

from PIL import Image, ImageOps, ImageTk

from ..models import BoardLayout
from ..storage import resolve_media_path


try:  # Pillow < 9.1 compatibility
    RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:  # pragma: no cover - depends on pillow version
    RESAMPLE = Image.LANCZOS


@dataclass
class TileGeometry:
    x: int
    y: int
    width: int
    height: int


class BoardCanvas(tk.Canvas):
    def __init__(self, master: tk.Misc, board: BoardLayout, tile_size: int = 110, **kwargs) -> None:
        self.tile_size = tile_size
        self.margin_x = int(tile_size * 1.0)
        self.margin_y = int(tile_size * 0.9)
        self.gap_x = int(tile_size * 0.45)
        self.gap_y = int(tile_size * 0.35)
        width = self.margin_x * 2 + board.cols * tile_size + (board.cols - 1) * self.gap_x
        height = self.margin_y * 2 + board.rows * tile_size + (board.rows - 1) * self.gap_y
        super().__init__(
            master,
            width=width,
            height=height,
            bg="#514a9d",
            highlightthickness=0,
            **kwargs,
        )
        self.board = board
        self._images: Dict[int, ImageTk.PhotoImage] = {}
        self._token_items: Dict[str, int] = {}
        self._token_positions: Dict[str, int] = {}
        self._tile_token_order: Dict[int, List[str]] = {}
        self.selected_index: Optional[int] = None
        self._tile_geometries: Dict[int, TileGeometry] = {}
        self.bind("<Button-1>", self._on_click)
        self.redraw()

    def _tile_geometry(self, index: int) -> TileGeometry:
        row = index // self.board.cols
        position_in_row = index % self.board.cols
        if row % 2 == 1:
            col = self.board.cols - 1 - position_in_row
        else:
            col = position_in_row
        x = self.margin_x + col * (self.tile_size + self.gap_x)
        y = self.margin_y + row * (self.tile_size + self.gap_y)
        return TileGeometry(x=x, y=y, width=self.tile_size, height=self.tile_size)

    def redraw(self) -> None:
        self.delete("all")
        self._images.clear()
        self._tile_geometries.clear()

        canvas_width = int(float(self.cget("width")))
        canvas_height = int(float(self.cget("height")))
        border = self.create_rectangle(
            20,
            20,
            canvas_width - 20,
            canvas_height - 20,
            fill="#6554af",
            outline="#f6bd60",
            width=6,
        )
        self.tag_lower(border)

        tile_entries = []
        centers = []
        for tile in self.board.tiles:
            geom = self._tile_geometry(tile.index)
            self._tile_geometries[tile.index] = geom
            cx = geom.x + geom.width / 2
            cy = geom.y + geom.height / 2
            tile_entries.append((tile, geom, cx, cy))
            centers.append((cx, cy))

        if len(centers) >= 2:
            for (start_x, start_y), (end_x, end_y) in zip(centers, centers[1:]):
                path = self.create_line(
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                    width=self.tile_size * 0.55,
                    fill="#f7b267",
                    capstyle=tk.ROUND,
                )
                overlay = self.create_line(
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                    width=self.tile_size * 0.18,
                    fill="#ffe8d6",
                    capstyle=tk.ROUND,
                )
                self.tag_lower(path)
                self.tag_lower(overlay)
                self.tag_raise(overlay, path)

        for tile, geom, cx, cy in tile_entries:
            x0, y0 = geom.x, geom.y
            x1, y1 = x0 + geom.width, y0 + geom.height
            base_color = "#f7f4f3"
            outline_color = "#f6bd60"
            text_color = "#3a0ca3"
            label = str(tile.index + 1)
            if tile.category == "start":
                base_color = "#90be6d"
                outline_color = "#386641"
                text_color = "#ffffff"
                label = "START"
            elif tile.category == "finish":
                base_color = "#f3722c"
                outline_color = "#f9844a"
                text_color = "#ffffff"
                label = "ZIEL"
            rect = self.create_rectangle(
                x0,
                y0,
                x1,
                y1,
                fill=base_color,
                outline=outline_color,
                width=4,
                tags=(f"tile-{tile.index}", "tile"),
            )
            self.tag_raise(rect)
            if tile.background:
                path = resolve_media_path(tile.background)
                if path and path.exists():
                    target_w = max(int(geom.width - 16), 24)
                    target_h = max(int(geom.height - 16), 24)
                    with Image.open(path) as image:
                        fitted = ImageOps.fit(image, (target_w, target_h), RESAMPLE)
                    photo = ImageTk.PhotoImage(fitted)
                    self._images[tile.index] = photo
                    self.create_image(
                        cx,
                        cy,
                        image=photo,
                        anchor="center",
                        tags=(f"tile-{tile.index}", "tile"),
                    )
            self.create_text(
                cx,
                cy,
                text=label,
                font=("Baloo", 18, "bold"),
                fill=text_color,
                tags=(f"tile-{tile.index}", "tile"),
            )
            if self.selected_index == tile.index:
                self.create_rectangle(
                    x0 + 6,
                    y0 + 6,
                    x1 - 6,
                    y1 - 6,
                    outline="#fffae5",
                    width=4,
                    dash=(6, 4),
                )

    def set_selected(self, index: Optional[int]) -> None:
        self.selected_index = index
        self.redraw()

    def _on_click(self, event: tk.Event) -> None:
        item = self.find_withtag("current")
        if not item:
            return
        tags = self.gettags(item)
        for tag in tags:
            if tag.startswith("tile-"):
                index = int(tag.split("-", 1)[1])
                self.set_selected(index)
                self.event_generate("<<TileSelected>>", data=str(index))
                break

    def update_token(self, token_id: str, tile_index: int, color: str) -> None:
        previous = self._token_positions.get(token_id)
        if previous is not None and previous != tile_index:
            tokens = self._tile_token_order.get(previous, [])
            if token_id in tokens:
                tokens.remove(token_id)
            if not tokens and previous in self._tile_token_order:
                del self._tile_token_order[previous]
        self._token_positions[token_id] = tile_index
        order = self._tile_token_order.setdefault(tile_index, [])
        if token_id not in order:
            order.append(token_id)
        if token_id not in self._token_items:
            geom = self._tile_geometry(tile_index)
            radius = self.tile_size // 6
            cx = geom.x + self.tile_size // 2
            cy = geom.y + self.tile_size // 2
            coords = (cx - radius, cy - radius, cx + radius, cy + radius)
            item = self.create_oval(*coords, fill=color, outline="#1d3557", width=2)
            self._token_items[token_id] = item
        else:
            self.itemconfig(self._token_items[token_id], fill=color)
        self._layout_tile_tokens(tile_index)
        if previous is not None and previous != tile_index:
            self._layout_tile_tokens(previous)

    def remove_token(self, token_id: str) -> None:
        item = self._token_items.pop(token_id, None)
        if item:
            self.delete(item)
        tile_index = self._token_positions.pop(token_id, None)
        if tile_index is not None:
            tokens = self._tile_token_order.get(tile_index, [])
            if token_id in tokens:
                tokens.remove(token_id)
            if tokens:
                self._layout_tile_tokens(tile_index)
            elif tile_index in self._tile_token_order:
                del self._tile_token_order[tile_index]

    def clear_tokens(self) -> None:
        for item in self._token_items.values():
            self.delete(item)
        self._token_items.clear()
        self._token_positions.clear()
        self._tile_token_order.clear()

    def _layout_tile_tokens(self, tile_index: int) -> None:
        tokens = self._tile_token_order.get(tile_index)
        if not tokens:
            return
        geom = self._tile_geometries.get(tile_index) or self._tile_geometry(tile_index)
        radius = self.tile_size // 6
        spacing = max(radius * 2 + 6, 22)
        cx = geom.x + geom.width / 2
        cy = geom.y + geom.height / 2
        for idx, token_id in enumerate(tokens):
            offset = (idx - (len(tokens) - 1) / 2) * spacing
            coords = (cx + offset - radius, cy - radius, cx + offset + radius, cy + radius)
            item_id = self._token_items[token_id]
            self.coords(item_id, *coords)
            self.tag_raise(item_id)
