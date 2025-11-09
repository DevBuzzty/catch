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
    MARGIN_X_RATIO = 1.0
    MARGIN_Y_RATIO = 0.9
    GAP_X_RATIO = 0.45
    GAP_Y_RATIO = 0.35

    def __init__(self, master: tk.Misc, board: BoardLayout, tile_size: int = 110, **kwargs) -> None:
        self.board = board
        self._base_tile_size = tile_size
        self.tile_size = tile_size
        self.margin_x = 0
        self.margin_y = 0
        self.gap_x = 0
        self.gap_y = 0
        self._base_width = 0
        self._base_height = 0
        self._configure_geometry(tile_size)
        super().__init__(
            master,
            width=self._base_width,
            height=self._base_height,
            bg="#514a9d",
            highlightthickness=0,
            **kwargs,
        )
        self._images: Dict[int, ImageTk.PhotoImage] = {}
        self._token_items: Dict[str, int] = {}
        self._token_positions: Dict[str, int] = {}
        self._tile_token_order: Dict[int, List[str]] = {}
        self._token_colors: Dict[str, str] = {}
        self.selected_index: Optional[int] = None
        self._tile_geometries: Dict[int, TileGeometry] = {}
        self.bind("<Button-1>", self._on_click)
        self.bind("<Configure>", self._on_canvas_configure)
        self.redraw()

    def _configure_geometry(self, tile_size: int) -> None:
        self.tile_size = max(60, int(tile_size))
        self.margin_x = int(self.tile_size * self.MARGIN_X_RATIO)
        self.margin_y = int(self.tile_size * self.MARGIN_Y_RATIO)
        self.gap_x = int(self.tile_size * self.GAP_X_RATIO)
        self.gap_y = int(self.tile_size * self.GAP_Y_RATIO)
        self._base_width = (
            self.margin_x * 2
            + self.board.cols * self.tile_size
            + (self.board.cols - 1) * self.gap_x
        )
        self._base_height = (
            self.margin_y * 2
            + self.board.rows * self.tile_size
            + (self.board.rows - 1) * self.gap_y
        )

    def _on_canvas_configure(self, event: tk.Event) -> None:  # pragma: no cover - UI event
        if event.width <= 1 or event.height <= 1:
            return
        width_factor = (
            self.board.cols
            + (self.board.cols - 1) * self.GAP_X_RATIO
            + 2 * self.MARGIN_X_RATIO
        )
        height_factor = (
            self.board.rows
            + (self.board.rows - 1) * self.GAP_Y_RATIO
            + 2 * self.MARGIN_Y_RATIO
        )
        new_size = int(min(event.width / width_factor, event.height / height_factor))
        if new_size <= 0:
            return
        if abs(new_size - self.tile_size) >= 1:
            self._configure_geometry(new_size)
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
        positions = dict(self._token_positions)
        colors = dict(self._token_colors)
        orders = {index: list(order) for index, order in self._tile_token_order.items()}

        self.delete("all")
        self._images.clear()
        self._tile_geometries.clear()
        self._token_items.clear()
        self._token_positions = {}
        self._tile_token_order = {}

        canvas_width = max(self.winfo_width(), self._base_width)
        canvas_height = max(self.winfo_height(), self._base_height)
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
        for tile in self.board.tiles:
            geom = self._tile_geometry(tile.index)
            self._tile_geometries[tile.index] = geom
            cx = geom.x + geom.width / 2
            cy = geom.y + geom.height / 2
            tile_entries.append((tile, geom, cx, cy))

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

        connectors = self._build_connector_paths(tile_entries)
        for coords in connectors:
            path = self.create_line(
                *coords,
                width=self.tile_size * 0.42,
                fill="#f7b267",
                capstyle=tk.ROUND,
                smooth=True,
                splinesteps=24,
                tags=("path",),
            )
            overlay = self.create_line(
                *coords,
                width=self.tile_size * 0.16,
                fill="#ffe8d6",
                capstyle=tk.ROUND,
                smooth=True,
                splinesteps=24,
                tags=("path", "path-highlight"),
            )
            self.tag_lower(path, "tile")
            self.tag_lower(overlay, "tile")
            self.tag_raise(overlay, path)

        if positions:
            self._token_colors = colors
            for tile_index in orders:
                for token_id in orders[tile_index]:
                    color = colors.get(token_id, "#1d3557")
                    position = positions.get(token_id, tile_index)
                    self.update_token(token_id, position, color)
            for token_id, position in positions.items():
                if token_id not in self._token_items:
                    color = colors.get(token_id, "#1d3557")
                    self.update_token(token_id, position, color)

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
        self._token_colors[token_id] = color
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
        self._token_colors.clear()

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

    def _build_connector_paths(self, tile_entries: List[tuple]) -> List[List[float]]:
        if len(tile_entries) < 2:
            return []

        connectors: List[List[float]] = []
        lateral_step = self.tile_size / 2 + self.gap_x / 2
        for idx in range(len(tile_entries) - 1):
            tile_a, _geom_a, ax, ay = tile_entries[idx]
            tile_b, _geom_b, bx, by = tile_entries[idx + 1]
            row_a = tile_a.index // self.board.cols
            row_b = tile_b.index // self.board.cols

            if row_a == row_b:
                connectors.append([ax, ay, bx, by])
                continue

            direction = 1 if row_a % 2 == 0 else -1
            pivot_x = ax + direction * lateral_step
            connectors.append([ax, ay, pivot_x, ay, pivot_x, by, bx, by])

        return connectors
