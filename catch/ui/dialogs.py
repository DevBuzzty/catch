"""Collection of Tkinter dialogs used by the application."""
from __future__ import annotations

import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk
from pathlib import Path
from typing import Callable, List

from ..models import PlayerData, TileData
from ..storage import set_tile_background


class PlayerSetupDialog(simpledialog.Dialog):
    def __init__(self, parent: tk.Misc, players: List[PlayerData]):
        self.players = [PlayerData(p.name, p.color, position=p.position, finished=p.finished) for p in players]
        super().__init__(parent, title="Spieler:innen bearbeiten")

    def body(self, master: tk.Misc) -> tk.Widget:
        self.tree = ttk.Treeview(master, columns=("name", "color"), show="headings", height=6)
        self.tree.heading("name", text="Name")
        self.tree.heading("color", text="Farbe")
        self.tree.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        for player in self.players:
            self.tree.insert("", tk.END, values=(player.name, player.color))

        button_frame = ttk.Frame(master)
        button_frame.pack(fill=tk.X, padx=10, pady=(0, 10))
        ttk.Button(button_frame, text="Neu", command=self._add_player).pack(side=tk.LEFT)
        ttk.Button(button_frame, text="Bearbeiten", command=self._edit_player).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Löschen", command=self._delete_player).pack(side=tk.LEFT)
        return self.tree

    def apply(self) -> None:  # noqa: D401
        """Store result."""
        self.result = self.players

    def _add_player(self) -> None:
        name = simpledialog.askstring("Neuer Name", "Name des Teams:", parent=self)
        if not name:
            return
        color = simpledialog.askstring("Farbe", "Farbe (Hex z.B. #ff0000):", parent=self, initialvalue="#ff0000")
        if not color:
            return
        player = PlayerData(name=name, color=color)
        self.players.append(player)
        self.tree.insert("", tk.END, values=(player.name, player.color))

    def _edit_player(self) -> None:
        selection = self.tree.selection()
        if not selection:
            return
        index = self.tree.index(selection[0])
        player = self.players[index]
        name = simpledialog.askstring("Name", "Neuer Name:", parent=self, initialvalue=player.name)
        if not name:
            return
        color = simpledialog.askstring("Farbe", "Farbe (Hex):", parent=self, initialvalue=player.color)
        if not color:
            return
        player.name = name
        player.color = color
        self.tree.item(selection[0], values=(player.name, player.color))

    def _delete_player(self) -> None:
        selection = self.tree.selection()
        if not selection:
            return
        index = self.tree.index(selection[0])
        del self.players[index]
        self.tree.delete(selection[0])


class TileEditDialog(simpledialog.Dialog):
    def __init__(self, parent: tk.Misc, tile: TileData):
        self.tile = tile
        super().__init__(parent, title=f"Feld {tile.index + 1} bearbeiten")

    def body(self, master: tk.Misc) -> tk.Widget:
        ttk.Label(master, text=f"Kategorie für Feld {self.tile.index + 1}").pack(anchor="w", padx=10, pady=(10, 0))
        self.category_var = tk.StringVar(value=self.tile.category)
        categories = ["start", "finish", "picture", "sound", "emoji", "filter"]
        self.category_box = ttk.Combobox(master, textvariable=self.category_var, values=categories, state="readonly")
        self.category_box.pack(fill=tk.X, padx=10, pady=5)

        ttk.Button(master, text="Hintergrundbild auswählen", command=self._choose_background).pack(fill=tk.X, padx=10, pady=5)
        if self.tile.background:
            ttk.Label(master, text=f"Aktuelles Bild: {self.tile.background}").pack(anchor="w", padx=10)
        return self.category_box

    def apply(self) -> None:
        self.tile.category = self.category_var.get()

    def _choose_background(self) -> None:
        filename = filedialog.askopenfilename(title="Bild auswählen", filetypes=[("Bilder", "*.png;*.jpg;*.jpeg;*.gif")])
        if not filename:
            return
        try:
            set_tile_background(self.tile, Path(filename))
            messagebox.showinfo("Gespeichert", "Hintergrund wurde kopiert und dem Feld zugewiesen.")
        except Exception as exc:  # pragma: no cover - user feedback only
            messagebox.showerror("Fehler", str(exc))


EMOJI_CHOICES = [
    "😀",
    "😁",
    "😂",
    "🤣",
    "😃",
    "😄",
    "😅",
    "😆",
    "😉",
    "😊",
    "😍",
    "😘",
    "😗",
    "😜",
    "🤩",
    "🤗",
    "🤔",
    "🤨",
    "😎",
    "🥳",
    "🤠",
    "😺",
    "😻",
    "🙈",
    "🙉",
    "🙊",
    "🐶",
    "🐱",
    "🐭",
    "🐸",
    "🐵",
    "🦊",
    "🐼",
    "🦄",
    "🐢",
    "🐧",
    "🐞",
    "🌈",
    "⭐",
    "⚽",
    "🏀",
    "🎲",
    "🎹",
    "🥁",
    "🚀",
    "✈️",
    "🚗",
    "🏰",
    "🧚",
    "🦸",
    "🍎",
    "🍉",
    "🍩",
    "🍪",
    "🍕",
    "🍟",
    "🌮",
    "🥨",
    "🍰",
    "🎂",
    "🍭",
    "☀️",
    "🌙",
    "⭐️",
    "⚡",
    "☁️",
    "❄️",
    "💡",
    "❤️",
    "💙",
    "💚",
    "💛",
    "💜",
    "🤍",
    "🤎",
    "🧠",
    "💪",
    "🖐️",
    "👍",
    "👎",
]


class EmojiKeyboard(tk.Toplevel):
    def __init__(self, parent: tk.Misc, on_pick: Callable[[str], None]):
        super().__init__(parent)
        self.on_pick = on_pick
        self.title("Emoji-Tastatur")
        self.transient(parent)
        self.resizable(False, False)
        self.configure(padx=10, pady=10)
        self._build_buttons()
        self.grab_set()
        self.protocol("WM_DELETE_WINDOW", self.destroy)

    def _build_buttons(self) -> None:
        columns = 8
        for index, emoji in enumerate(EMOJI_CHOICES):
            button = ttk.Button(self, text=emoji, width=4, command=lambda e=emoji: self._select(e))
            row = index // columns
            column = index % columns
            button.grid(row=row, column=column, padx=2, pady=2)

    def _select(self, emoji: str) -> None:
        self.on_pick(emoji)
        self.destroy()


class EmojiPromptDialog(simpledialog.Dialog):
    def __init__(self, parent: tk.Misc):
        self.prompt_var = tk.StringVar()
        self.entry: ttk.Entry
        super().__init__(parent, title="Emoji auswählen")

    def body(self, master: tk.Misc) -> tk.Widget:
        ttk.Label(master, text="Emoji oder Hinweistext:").pack(anchor="w", padx=10, pady=(10, 0))
        frame = ttk.Frame(master)
        frame.pack(fill=tk.X, padx=10, pady=5)
        self.entry = ttk.Entry(frame, textvariable=self.prompt_var, font=("Segoe UI Emoji", 18))
        self.entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(frame, text="Emoji-Tastatur", command=self._open_keyboard).pack(side=tk.LEFT, padx=(8, 0))
        return self.entry

    def apply(self) -> None:
        self.result = self.prompt_var.get().strip()

    def _open_keyboard(self) -> None:
        keyboard = EmojiKeyboard(self, self._insert_emoji)
        keyboard.wait_window()

    def _insert_emoji(self, emoji: str) -> None:
        self.entry.insert(tk.INSERT, emoji)
        self.prompt_var.set(self.entry.get())

