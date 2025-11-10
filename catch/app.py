"""Tkinter application for the Catch classroom board game."""
from __future__ import annotations

import random
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk
from pathlib import Path
from typing import List, Optional

from .models import AIPuzzle, EmojiPuzzle, GameDocument, PicturePuzzle, PlayerData, SoundPuzzle
from .puzzles import PuzzleDeck, PuzzleSelection, SoundPlayer, load_image, load_random_snippet
from .storage import (
    DATA_DIR,
    add_ai_puzzle,
    add_board_backgrounds,
    add_emoji_puzzle,
    add_picture_puzzle,
    add_sound_puzzle,
    ensure_directories,
    export_template,
    load_document,
    save_document,
)
from .ui.board_canvas import BoardCanvas
from .ui.dialogs import EmojiPromptDialog, PlayerSetupDialog, TileEditDialog


class CatchApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        ensure_directories()
        self.title("Catch – Klassen-Spielbrett")
        self.geometry("1280x840")
        self.minsize(1100, 720)
        self.document: GameDocument = load_document()
        self._recent_categories: List[str] = []
        self._reset_deck()
        self.sound_player = SoundPlayer()
        self.current_player_index: int = 0
        self.cheer_label: Optional[tk.Label] = None
        self._puzzles_window: Optional[tk.Toplevel] = None
        self._player_dialog: Optional[PlayerSetupDialog] = None
        self._player_dialog_open = False

        self._create_menu()
        self._create_layout()
        self._refresh_board()
        self._refresh_players()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.after(0, self._setup_fullscreen)

    # ------------------------------------------------------------------ UI
    def _setup_fullscreen(self) -> None:  # pragma: no cover - UI behavior
        try:
            self.attributes("-fullscreen", True)
        except tk.TclError:
            try:
                self.state("zoomed")
            except tk.TclError:
                pass

    def _create_menu(self) -> None:
        menu_bar = tk.Menu(self)
        file_menu = tk.Menu(menu_bar, tearoff=False)
        file_menu.add_command(label="Speichern", command=self.save)
        file_menu.add_command(label="Speichern unter…", command=self.save_as)
        file_menu.add_separator()
        file_menu.add_command(label="Vorlage aktualisieren", command=self.save_template)
        file_menu.add_command(label="Vorlage neu laden", command=self.reset_to_template)
        file_menu.add_separator()
        file_menu.add_command(label="Beenden", command=self._on_close)
        menu_bar.add_cascade(label="Datei", menu=file_menu)

        edit_menu = tk.Menu(menu_bar, tearoff=False)
        edit_menu.add_command(label="Spieler:innen", command=self.edit_players)
        edit_menu.add_command(label="Puzzles verwalten", command=self.manage_puzzles)
        menu_bar.add_cascade(label="Bearbeiten", menu=edit_menu)

        board_menu = tk.Menu(menu_bar, tearoff=False)
        board_menu.add_command(label="Ausgewähltes Feld bearbeiten", command=self.edit_selected_tile)
        board_menu.add_command(label="Hintergründe hochladen", command=self.upload_board_backgrounds)
        menu_bar.add_cascade(label="Spielbrett", menu=board_menu)

        help_menu = tk.Menu(menu_bar, tearoff=False)
        help_menu.add_command(label="Info", command=self.show_about)
        menu_bar.add_cascade(label="Hilfe", menu=help_menu)

        self.config(menu=menu_bar)

    def _create_layout(self) -> None:
        container = ttk.Frame(self)
        container.pack(fill=tk.BOTH, expand=True)

        self.board_canvas = BoardCanvas(container, self.document.board)
        self.board_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=10, pady=10)
        self.board_canvas.bind("<<TileSelected>>", self._on_tile_selected)

        sidebar = ttk.Frame(container, width=320)
        sidebar.pack(side=tk.RIGHT, fill=tk.Y, padx=10, pady=10)
        sidebar.pack_propagate(False)

        self.turn_label = ttk.Label(sidebar, text="Am Zug: —", font=("Helvetica", 14, "bold"))
        self.turn_label.pack(fill=tk.X, pady=10)

        dice_frame = ttk.Frame(sidebar)
        dice_frame.pack(fill=tk.X, pady=10)
        self.dice_result = tk.StringVar(value="Würfeln!")
        ttk.Button(dice_frame, text="🎲 Würfeln", command=self.roll_dice).pack(side=tk.LEFT)
        ttk.Label(dice_frame, textvariable=self.dice_result, font=("Helvetica", 14)).pack(side=tk.LEFT, padx=10)

        ttk.Button(sidebar, text="Spieler:innen bearbeiten", command=self.edit_players).pack(fill=tk.X, pady=5)
        ttk.Button(sidebar, text="Puzzles verwalten", command=self.manage_puzzles).pack(fill=tk.X, pady=5)
        ttk.Button(sidebar, text="Spiel speichern", command=self.save).pack(fill=tk.X, pady=5)

        ttk.Separator(sidebar).pack(fill=tk.X, pady=10)
        ttk.Label(sidebar, text="Positionen", font=("Helvetica", 12, "bold")).pack(anchor="w")
        self.player_list = tk.Listbox(sidebar, height=6)
        self.player_list.pack(fill=tk.X, pady=5)

        ttk.Label(sidebar, text="Rangliste", font=("Helvetica", 12, "bold")).pack(anchor="w", pady=(10, 0))
        self.rank_list = tk.Listbox(sidebar, height=6)
        self.rank_list.pack(fill=tk.X, pady=5)

        info = (
            "Tipp: Klicken Sie auf ein Feld, um es auszuwählen und anschließend \n"
            "über das Menü 'Spielbrett' die Kategorie oder den Hintergrund zu ändern."
        )
        ttk.Label(sidebar, text=info, wraplength=280, justify=tk.LEFT).pack(fill=tk.X, pady=10)

    # ---------------------------------------------------------------- Board / players
    def _refresh_board(self) -> None:
        self.board_canvas.board = self.document.board
        self.board_canvas.redraw()
        self.board_canvas.clear_tokens()
        for player in self.document.players:
            self.board_canvas.update_token(player.name, player.position, player.color)

    def _refresh_players(self) -> None:
        self.player_list.delete(0, tk.END)
        for player in self.document.players:
            status = "🏁" if player.finished else f"Feld {player.position + 1}"
            self.player_list.insert(tk.END, f"{player.name}: {status}")
        if self.document.players:
            active = self.document.players[self.current_player_index % len(self.document.players)]
            self.turn_label.config(text=f"Am Zug: {active.name}")
        else:
            self.turn_label.config(text="Am Zug: —")
        self._refresh_ranking()

    def _refresh_ranking(self) -> None:
        self.rank_list.delete(0, tk.END)
        for index, name in enumerate(self.document.finish_order, start=1):
            self.rank_list.insert(tk.END, f"{index}. {name}")

    # ---------------------------------------------------------------- Events
    def _on_tile_selected(self, event: tk.Event) -> None:  # pragma: no cover - GUI event
        data = getattr(event, "data", None)
        try:
            index = int(data)
        except (TypeError, ValueError):
            return
        self.board_canvas.set_selected(index)

    def roll_dice(self) -> None:
        if not self.document.players:
            messagebox.showinfo("Info", "Bitte legen Sie zuerst Spieler:innen an.", parent=self)
            return
        player = self.document.players[self.current_player_index]
        if player.finished:
            self._advance_player()
            return
        roll = random.randint(1, 6)
        self.dice_result.set(str(roll))
        self._move_player(player, roll)

    def _move_player(self, player: PlayerData, steps: int) -> None:
        origin_index = player.position
        target_index = origin_index + steps
        last_index = len(self.document.board.tiles) - 1
        if target_index >= last_index:
            player.position = last_index
            player.finished = True
            if player.name not in self.document.finish_order:
                self.document.finish_order.append(player.name)
            self.board_canvas.update_token(player.name, player.position, player.color)
            self._refresh_players()
            self._celebrate(player.name)
            self._advance_player()
            return

        player.position = target_index
        self.board_canvas.update_token(player.name, player.position, player.color)
        self._refresh_players()
        tile = self.document.board.tile_at(target_index)
        if tile.category in {"picture", "sound", "emoji", "ai"}:
            self._present_puzzle(tile.category, player, origin_index)
        else:
            self._advance_player()

    def _present_puzzle(self, category: str, player: PlayerData, origin_index: int) -> None:
        requested = category
        category = self._select_category(requested)
        selection = self.deck.next_for(category)
        if not selection and category != requested:
            selection = self.deck.next_for(requested)
            if selection:
                category = requested
        if not selection:
            messagebox.showinfo(
                "Keine Rätsel",
                "Für diese Kategorie sind noch keine Inhalte vorhanden.",
                parent=self,
            )
            self._advance_player()
            return
        self._recent_categories.append(category)
        if len(self._recent_categories) > 2:
            self._recent_categories = self._recent_categories[-2:]
        handler = {
            "picture": self._show_picture_puzzle,
            "sound": self._show_sound_puzzle,
            "emoji": self._show_emoji_puzzle,
            "ai": self._show_ai_puzzle,
        }[category]
        handler(selection, player, origin_index)

    def _select_category(self, requested: str) -> str:
        recent = self._recent_categories[-2:]
        if len(recent) == 2 and recent[0] == recent[1] == requested:
            alternatives = [cat for cat in ("picture", "sound", "emoji", "ai") if cat != requested]
            random.shuffle(alternatives)
            for candidate in alternatives:
                if self.deck.has_puzzles(candidate):
                    return candidate
        return requested

    def _reset_deck(self) -> None:
        self.deck = PuzzleDeck(self.document.puzzles)
        self._recent_categories.clear()

    def _normalize(self, value: str) -> str:
        return value.strip().lower()

    def _handle_result(self, player: PlayerData, correct: bool, origin_index: int) -> None:
        if correct:
            messagebox.showinfo("Richtig!", "Sehr gut! Weiter geht's.", parent=self)
            self._advance_player()
        else:
            messagebox.showwarning(
                "Falsch",
                "Leider falsch. Die Figur geht auf das vorherige Feld zurück.",
                parent=self,
            )
            player.position = origin_index
            player.finished = False
            self.board_canvas.update_token(player.name, player.position, player.color)
            self._refresh_players()
            self._advance_player()

    def _show_picture_puzzle(
        self, selection: PuzzleSelection, player: PlayerData, origin_index: int
    ) -> None:
        puzzle: PicturePuzzle = selection.payload  # type: ignore[assignment]
        window = tk.Toplevel(self)
        window.title("Bild erraten")
        window.transient(self)
        window.grab_set()
        window.resizable(False, False)
        image_size = self._modal_image_size()
        try:
            snippet = load_random_snippet(puzzle.full_path, size=(image_size, image_size))
        except FileNotFoundError:
            fallback = puzzle.snippet_path or puzzle.full_path
            snippet = load_image(fallback, size=(image_size, image_size))
        content = ttk.Frame(window)
        content.pack(padx=10, pady=10)

        snippet_label = ttk.Label(content, image=snippet)
        snippet_label.pack()

        # Keep reference to prevent garbage collection and allow later updates
        window._current_image = snippet  # type: ignore[attr-defined]

        entry = ttk.Entry(window, width=40)
        entry.pack(padx=10, pady=5)
        entry.focus_set()

        status_label = ttk.Label(window, text="")
        status_label.pack(pady=(0, 5))

        def cancel() -> None:
            window.destroy()
            self._handle_result(player, False, origin_index)

        def submit() -> None:
            answer = entry.get()
            correct = self._normalize(answer) == self._normalize(puzzle.answer)
            if correct:
                screen_w = max(self.winfo_screenwidth(), 1280)
                screen_h = max(self.winfo_screenheight(), 720)
                max_width = int(screen_w * 0.48)
                max_height = int(screen_h * 0.7)
                full_img = load_image(puzzle.full_path, size=(max_width, max_height))
                status_label.config(text="Richtig!", font=("Helvetica", 12, "bold"))
                entry.config(state=tk.DISABLED)
                submit_button.config(state=tk.DISABLED)
                snippet_label.config(image=full_img)
                window._current_image = full_img  # type: ignore[attr-defined]
                window.update_idletasks()
                self._center_modal(window)
            delay = 2000 if correct else 200
            window.after(
                delay,
                lambda: (
                    window.destroy(),
                    self._handle_result(player, correct, origin_index),
                ),
            )

        submit_button = ttk.Button(window, text="Antwort prüfen", command=submit)
        submit_button.pack(pady=10)
        window.protocol("WM_DELETE_WINDOW", cancel)
        self._center_modal(window)

    def _show_sound_puzzle(
        self, selection: PuzzleSelection, player: PlayerData, origin_index: int
    ) -> None:
        puzzle: SoundPuzzle = selection.payload  # type: ignore[assignment]
        window = tk.Toplevel(self)
        window.title("Geräusch erraten")
        window.transient(self)
        window.grab_set()
        window.resizable(False, False)
        ttk.Label(window, text="Klick auf 'Abspielen' und gib dann deine Vermutung ein.").pack(padx=10, pady=10)
        entry = ttk.Entry(window, width=30)
        entry.pack(padx=10, pady=5)

        def cancel() -> None:
            window.destroy()
            self._handle_result(player, False, origin_index)

        def play() -> None:
            try:
                self.sound_player.play(puzzle.audio_path)
            except Exception as exc:  # pragma: no cover - hardware dependent
                messagebox.showerror("Audio", str(exc), parent=window)

        def submit() -> None:
            guess = entry.get()
            correct = self._normalize(guess) == self._normalize(puzzle.answer)
            try:
                self.sound_player.stop()
            except Exception:
                pass
            window.destroy()
            self._handle_result(player, correct, origin_index)

        ttk.Button(window, text="▶ Abspielen", command=play).pack(pady=5)
        ttk.Button(window, text="Antwort prüfen", command=submit).pack(pady=10)
        window.protocol("WM_DELETE_WINDOW", cancel)
        self._center_modal(window)

    def _show_emoji_puzzle(
        self, selection: PuzzleSelection, player: PlayerData, origin_index: int
    ) -> None:
        puzzle: EmojiPuzzle = selection.payload  # type: ignore[assignment]
        window = tk.Toplevel(self)
        window.title("Emoji-Rätsel")
        window.transient(self)
        window.grab_set()
        window.resizable(False, False)
        ttk.Label(window, text=puzzle.prompt, font=("Segoe UI Emoji", 24)).pack(padx=10, pady=10)
        entry = ttk.Entry(window, width=40)
        entry.pack(padx=10, pady=5)

        def cancel() -> None:
            window.destroy()
            self._handle_result(player, False, origin_index)

        def submit() -> None:
            guess = entry.get()
            correct = self._normalize(guess) == self._normalize(puzzle.answer)
            window.destroy()
            self._handle_result(player, correct, origin_index)

        ttk.Button(window, text="Antwort prüfen", command=submit).pack(pady=10)
        window.protocol("WM_DELETE_WINDOW", cancel)
        self._center_modal(window)

    def _show_ai_puzzle(
        self, selection: PuzzleSelection, player: PlayerData, origin_index: int
    ) -> None:
        puzzle: AIPuzzle = selection.payload  # type: ignore[assignment]
        window = tk.Toplevel(self)
        window.title("KI-Rätsel")
        window.transient(self)
        window.grab_set()
        window.resizable(False, False)
        ttk.Label(window, text="Welches Bild wurde von KI erzeugt?", font=("Helvetica", 14, "bold")).pack(
            padx=10, pady=(10, 5)
        )
        container = ttk.Frame(window)
        container.pack(padx=10, pady=10)

        image_size = self._modal_image_size()
        options = [
            ("real", load_image(puzzle.real_path, size=(image_size, image_size))),
            ("ai", load_image(puzzle.ai_path, size=(image_size, image_size))),
        ]
        random.shuffle(options)
        window._images = [img for _, img in options]  # type: ignore[attr-defined]

        def choose(kind: str) -> None:
            correct = kind == "ai"
            window.destroy()
            self._handle_result(player, correct, origin_index)

        for column, (kind, image) in enumerate(options):
            frame = ttk.Frame(container)
            frame.grid(row=0, column=column, padx=10)
            button = ttk.Button(frame, image=image, command=lambda k=kind: choose(k))
            button.grid(row=0, column=0)
            label_text = "Bild 1" if column == 0 else "Bild 2"
            ttk.Label(frame, text=label_text, font=("Helvetica", 11, "bold")).grid(row=1, column=0, pady=(6, 0))

        ttk.Button(window, text="Abbrechen", command=lambda: choose("none")).pack(pady=(0, 10))
        window.protocol("WM_DELETE_WINDOW", lambda: choose("none"))
        self._center_modal(window)

    def _advance_player(self) -> None:
        if not self.document.players:
            return
        self.current_player_index = (self.current_player_index + 1) % len(self.document.players)
        self._refresh_players()

    # ---------------------------------------------------------------- Manage board
    def edit_selected_tile(self) -> None:
        index = self.board_canvas.selected_index
        if index is None:
            messagebox.showinfo("Auswahl", "Bitte klicken Sie zuerst auf ein Feld.", parent=self)
            return
        tile = self.document.board.tile_at(index)
        if tile.category in {"start", "finish"}:
            messagebox.showinfo(
                "Hinweis",
                "Start- und Zielfelder können nicht bearbeitet werden.",
                parent=self,
            )
            return
        TileEditDialog(self, tile)
        self._refresh_board()
        self.save()

    def upload_board_backgrounds(self) -> None:
        filenames = filedialog.askopenfilenames(
            title="Bilder für Spielfelder auswählen",
            filetypes=[("Bilder", "*.png;*.jpg;*.jpeg;*.gif")],
        )
        if not filenames:
            return
        images = [Path(name) for name in filenames]
        try:
            stored = add_board_backgrounds(images)
        except Exception as exc:  # pragma: no cover - user feedback only
            messagebox.showerror("Hintergründe", str(exc), parent=self)
            return
        if not stored:
            messagebox.showinfo("Hintergründe", "Es wurden keine Bilder übernommen.", parent=self)
            return
        self._assign_backgrounds_randomly(stored)
        self._refresh_board()
        self.save()
        messagebox.showinfo(
            "Hintergründe",
            "Die Bilder wurden kopiert und zufällig auf das Spielbrett verteilt.",
            parent=self,
        )

    def _assign_backgrounds_randomly(self, backgrounds: List[str]) -> None:
        if not backgrounds:
            return
        tiles = [tile for tile in self.document.board.tiles if tile.category not in {"start", "finish"}]
        if not tiles:
            return
        shuffled_tiles = tiles[:]
        random.shuffle(shuffled_tiles)
        assignments: List[str] = []
        while len(assignments) < len(shuffled_tiles):
            batch = backgrounds[:]
            random.shuffle(batch)
            assignments.extend(batch)
        for tile, background in zip(shuffled_tiles, assignments):
            tile.background = background

    def _modal_image_size(self) -> int:
        screen_w = max(self.winfo_screenwidth(), 1280)
        screen_h = max(self.winfo_screenheight(), 720)
        size_from_height = int(screen_h * 0.34)
        size_from_width = int(screen_w * 0.28)
        return max(260, min(size_from_height, size_from_width))

    def _center_modal(self, window: tk.Toplevel) -> None:  # pragma: no cover - geometry helper
        window.update_idletasks()
        screen_w = window.winfo_screenwidth()
        screen_h = window.winfo_screenheight()
        width = min(window.winfo_width(), int(screen_w * 0.92))
        height = min(window.winfo_height(), int(screen_h * 0.9))
        x = max((screen_w - width) // 2, 0)
        y = max((screen_h - height) // 2, 0)
        window.geometry(f"{width}x{height}+{x}+{y}")
        window.lift()

    # ---------------------------------------------------------------- Manage players
    def edit_players(self) -> None:
        if self._player_dialog_open and self._player_dialog and self._player_dialog.winfo_exists():
            self._player_dialog.lift()
            self._player_dialog.focus_force()
            return
        self._player_dialog_open = True
        try:
            dialog = PlayerSetupDialog(self, self.document.players)
            self._player_dialog = dialog
        finally:
            self._player_dialog_open = False
        result = dialog.result
        self._player_dialog = None
        if result is None:
            return
        self.document.players = result
        for player in self.document.players:
            player.position = 0
            player.finished = False
        self.document.finish_order.clear()
        self.current_player_index = 0
        self._refresh_board()
        self._refresh_players()
        self.save()

    # ---------------------------------------------------------------- Manage puzzles
    def manage_puzzles(self) -> None:
        if self._puzzles_window and self._puzzles_window.winfo_exists():
            self._puzzles_window.lift()
            self._puzzles_window.focus_force()
            return
        window = tk.Toplevel(self)
        window.title("Puzzles verwalten")
        self._puzzles_window = window
        window.transient(self)
        window.focus_set()
        window.grab_set()
        window.lift()

        def on_close() -> None:
            if self._puzzles_window is window:
                self._puzzles_window = None
            if window.grab_current() is window:
                window.grab_release()
            window.destroy()

        window.protocol("WM_DELETE_WINDOW", on_close)

        def _cleanup(event: tk.Event) -> None:
            if event.widget is window:
                if window.grab_current() is window:
                    window.grab_release()
                if self._puzzles_window is window:
                    self._puzzles_window = None

        window.bind("<Destroy>", _cleanup)

        notebook = ttk.Notebook(window)
        notebook.pack(fill=tk.BOTH, expand=True)

        def make_list(category: str, columns: List[str]) -> ttk.Treeview:
            tree = ttk.Treeview(notebook, columns=columns, show="headings")
            for col, label in zip(columns, columns):
                tree.heading(col, text=label.title())
                tree.column(col, width=180, anchor="w")
            tree.pack(fill=tk.BOTH, expand=True)
            notebook.add(tree, text=category.title())
            return tree

        tree_picture = make_list("picture", ["Antwort"])
        tree_sound = make_list("sound", ["Antwort", "Datei"])
        tree_emoji = make_list("emoji", ["Prompt", "Antwort"])
        tree_ai = make_list("ai", ["Echt", "KI"])

        def refresh() -> None:
            for tree in [tree_picture, tree_sound, tree_emoji, tree_ai]:
                for item in tree.get_children():
                    tree.delete(item)
            for puzzle in self.document.puzzles.get("picture", []):
                tree_picture.insert("", tk.END, iid=puzzle.id, values=(puzzle.answer,))
            for puzzle in self.document.puzzles.get("sound", []):
                tree_sound.insert("", tk.END, iid=puzzle.id, values=(puzzle.answer, puzzle.audio_path))
            for puzzle in self.document.puzzles.get("emoji", []):
                tree_emoji.insert("", tk.END, iid=puzzle.id, values=(puzzle.prompt, puzzle.answer))
            for puzzle in self.document.puzzles.get("ai", []):
                tree_ai.insert(
                    "",
                    tk.END,
                    iid=puzzle.id,
                    values=(Path(puzzle.real_path).name, Path(puzzle.ai_path).name),
                )

        refresh()

        button_frame = ttk.Frame(window)
        button_frame.pack(fill=tk.X, pady=10)

        def add_picture() -> None:
            full = filedialog.askopenfilename(
                title="Bild auswählen",
                filetypes=[("Bilder", "*.png;*.jpg;*.jpeg;*.gif")],
            )
            if not full:
                return
            answer = simpledialog.askstring("Bild", "Lösung / Titel des Bildes:", parent=window)
            if not answer:
                return
            add_picture_puzzle(self.document, answer, Path(full))
            refresh()
            self._reset_deck()
            self.save()

        def add_sound() -> None:
            audio = filedialog.askopenfilename(
                title="Audiodatei auswählen",
                filetypes=[("Audio", "*.mp3;*.wav;*.ogg")],
            )
            if not audio:
                return
            answer = simpledialog.askstring("Geräusch", "Was ist zu hören?", parent=window)
            if not answer:
                return
            add_sound_puzzle(self.document, answer, Path(audio))
            refresh()
            self._reset_deck()
            self.save()

        def add_emoji() -> None:
            dialog = EmojiPromptDialog(window)
            prompt = dialog.result
            if not prompt:
                return
            answer = simpledialog.askstring("Emoji", "Lösung:", parent=window)
            if not answer:
                return
            add_emoji_puzzle(self.document, prompt, answer)
            refresh()
            self._reset_deck()
            self.save()

        def add_ai() -> None:
            messagebox.showinfo("KI-Rätsel", "Lade jetzt das echte Bild hoch und bestätige mit OK.", parent=window)
            real_image = filedialog.askopenfilename(
                title="Echtes Bild auswählen",
                filetypes=[("Bilder", "*.png;*.jpg;*.jpeg;*.gif")],
            )
            if not real_image:
                return
            messagebox.showinfo("KI-Rätsel", "Lade jetzt das KI-Bild hoch und bestätige mit OK.", parent=window)
            ai_image = filedialog.askopenfilename(
                title="KI-Bild auswählen",
                filetypes=[("Bilder", "*.png;*.jpg;*.jpeg;*.gif")],
            )
            if not ai_image:
                return
            add_ai_puzzle(self.document, Path(real_image), Path(ai_image))
            refresh()
            self._reset_deck()
            self.save()

        def delete_selected() -> None:
            tree = notebook.nametowidget(notebook.select())
            selection = tree.selection()
            if not selection:
                return
            puzzle_id = selection[0]
            category = notebook.tab(notebook.select(), "text").lower()
            items = self.document.puzzles.get(category, [])
            self.document.puzzles[category] = [item for item in items if item.id != puzzle_id]
            refresh()
            self._reset_deck()
            self.save()

        ttk.Button(button_frame, text="Bildrätsel hinzufügen", command=add_picture).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Geräusch hinzufügen", command=add_sound).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Emoji hinzufügen", command=add_emoji).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="KI-Rätsel hinzufügen", command=add_ai).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Markiertes Rätsel löschen", command=delete_selected).pack(side=tk.LEFT, padx=5)
        self._center_modal(window)

    # ---------------------------------------------------------------- Cheer animation
    def _celebrate(self, player_name: str) -> None:
        if self.cheer_label:
            self.cheer_label.destroy()
        label = tk.Label(self.board_canvas, text=f"🎉 {player_name} im Ziel!", font=("Helvetica", 18, "bold"), bg="#ffb703")
        label.place(relx=0.5, rely=0.1, anchor="center")
        self.cheer_label = label

        colors = ["#ffb703", "#fb8500", "#ff006e"]

        def animate(step: int = 0) -> None:
            if not self.cheer_label:
                return
            self.cheer_label.config(bg=colors[step % len(colors)])
            if step < 12:
                self.after(200, animate, step + 1)
            else:
                self.cheer_label.destroy()
                self.cheer_label = None

        animate(0)

    # ---------------------------------------------------------------- Save/load helpers
    def save(self) -> None:
        save_document(self.document)

    def save_as(self) -> None:
        filename = filedialog.asksaveasfilename(title="Speichern unter", defaultextension=".json", filetypes=[("JSON", "*.json")])
        if not filename:
            return
        save_document(self.document, Path(filename))

    def save_template(self) -> None:
        export_template(self.document)
        messagebox.showinfo("Vorlage", "Die aktuelle Konfiguration wurde als Vorlage gespeichert.", parent=self)

    def reset_to_template(self) -> None:
        template_path = DATA_DIR / "template.json"
        if not template_path.exists():
            messagebox.showerror("Vorlage", "Es wurde noch keine Vorlage gespeichert.", parent=self)
            return
        self.document = load_document(template_path)
        self._reset_deck()
        for player in self.document.players:
            player.position = 0
            player.finished = False
        self.document.finish_order.clear()
        self.current_player_index = 0
        self._refresh_board()
        self._refresh_players()
        self.save()
        messagebox.showinfo(
            "Vorlage",
            "Die Vorlage wurde geladen. Vergessen Sie nicht, danach zu speichern!",
            parent=self,
        )

    def show_about(self) -> None:
        messagebox.showinfo(
            "Über Catch",
            "Catch – ein anpassbares Spielbrett für die digitale Tafel.\n"
            "Laden Sie eigene Inhalte hoch, speichern Sie das Spiel und verteilen\n"
            "Sie den gesamten Ordner (inkl. data/) auf einen USB-Stick.",
            parent=self,
        )

    def _on_close(self) -> None:
        self.save()
        self.destroy()


def run() -> None:
    app = CatchApp()
    app.mainloop()


if __name__ == "__main__":
    run()
