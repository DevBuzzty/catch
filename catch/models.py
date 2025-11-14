"""Data models for the Catch classroom board game."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple


PUZZLE_CATEGORIES = ["picture", "sound", "emoji", "ai"]


@dataclass
class TileData:
    """Represents a single tile on the board."""

    index: int
    category: str = "picture"
    background: Optional[str] = None  # Path relative to data directory

    def to_dict(self) -> Dict:
        return {"index": self.index, "category": self.category, "background": self.background}

    @staticmethod
    def from_dict(data: Dict) -> "TileData":
        category = data.get("category", "picture")
        if category == "filter":
            category = "ai"
        return TileData(index=data["index"], category=category, background=data.get("background"))


@dataclass
class PlayerData:
    name: str
    color: str
    position: int = 0
    finished: bool = False

    def to_dict(self) -> Dict:
        return asdict(self)

    @staticmethod
    def from_dict(data: Dict) -> "PlayerData":
        return PlayerData(name=data["name"], color=data["color"], position=data.get("position", 0), finished=data.get("finished", False))


@dataclass
class PicturePuzzle:
    answer: str
    full_path: str
    id: str
    snippet_path: Optional[str] = None

    def to_dict(self) -> Dict:
        return {
            "answer": self.answer,
            "full_path": self.full_path,
            "id": self.id,
            "snippet_path": self.snippet_path,
        }

    @staticmethod
    def from_dict(data: Dict) -> "PicturePuzzle":
        return PicturePuzzle(
            answer=data["answer"],
            full_path=data["full_path"],
            id=data["id"],
            snippet_path=data.get("snippet_path"),
        )


@dataclass
class SoundPuzzle:
    answer: str
    audio_path: str
    id: str

    def to_dict(self) -> Dict:
        return {"answer": self.answer, "audio_path": self.audio_path, "id": self.id}

    @staticmethod
    def from_dict(data: Dict) -> "SoundPuzzle":
        return SoundPuzzle(answer=data["answer"], audio_path=data["audio_path"], id=data["id"])


@dataclass
class EmojiPuzzle:
    prompt: str
    answer: str
    id: str

    def to_dict(self) -> Dict:
        return {"prompt": self.prompt, "answer": self.answer, "id": self.id}

    @staticmethod
    def from_dict(data: Dict) -> "EmojiPuzzle":
        return EmojiPuzzle(prompt=data["prompt"], answer=data["answer"], id=data["id"])


@dataclass
class AIPuzzle:
    real_path: str
    ai_path: str
    id: str

    def to_dict(self) -> Dict:
        return {"real_path": self.real_path, "ai_path": self.ai_path, "id": self.id}

    @staticmethod
    def from_dict(data: Dict) -> "AIPuzzle":
        return AIPuzzle(real_path=data["real_path"], ai_path=data["ai_path"], id=data["id"])


PuzzleBank = Dict[str, List]


@dataclass
class BoardLayout:
    rows: int
    cols: int
    tiles: List[TileData] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "rows": self.rows,
            "cols": self.cols,
            "tiles": [tile.to_dict() for tile in self.tiles],
        }

    @staticmethod
    def from_dict(data: Dict) -> "BoardLayout":
        tiles = [TileData.from_dict(entry) for entry in data.get("tiles", [])]
        return BoardLayout(rows=data["rows"], cols=data["cols"], tiles=tiles)

    def tile_at(self, index: int) -> TileData:
        return self.tiles[index]


@dataclass
class GameDocument:
    board: BoardLayout
    puzzles: Dict[str, List]
    players: List[PlayerData]
    finish_order: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "board": self.board.to_dict(),
            "puzzles": {
                "picture": [p.to_dict() for p in self.puzzles.get("picture", [])],
                "sound": [p.to_dict() for p in self.puzzles.get("sound", [])],
                "emoji": [p.to_dict() for p in self.puzzles.get("emoji", [])],
                "ai": [p.to_dict() for p in self.puzzles.get("ai", [])],
            },
            "players": [player.to_dict() for player in self.players],
            "finish_order": self.finish_order,
        }

    @staticmethod
    def from_dict(data: Dict) -> "GameDocument":
        board = BoardLayout.from_dict(data["board"])
        puzzles = {
            "picture": [PicturePuzzle.from_dict(p) for p in data.get("puzzles", {}).get("picture", [])],
            "sound": [SoundPuzzle.from_dict(p) for p in data.get("puzzles", {}).get("sound", [])],
            "emoji": [EmojiPuzzle.from_dict(p) for p in data.get("puzzles", {}).get("emoji", [])],
            "ai": [AIPuzzle.from_dict(p) for p in data.get("puzzles", {}).get("ai", [])],
        }
        players = [PlayerData.from_dict(p) for p in data.get("players", [])]
        finish_order = data.get("finish_order", [])
        return GameDocument(board=board, puzzles=puzzles, players=players, finish_order=finish_order)


def default_board(rows: int = 5, cols: int = 6) -> BoardLayout:
    tiles: List[TileData] = []
    total = rows * cols
    for idx in range(total):
        category = "picture"
        if idx == 0:
            category = "start"
        elif idx == total - 1:
            category = "finish"
        else:
            category = PUZZLE_CATEGORIES[idx % len(PUZZLE_CATEGORIES)]
        tiles.append(TileData(index=idx, category=category))
    return BoardLayout(rows=rows, cols=cols, tiles=tiles)


def default_document() -> GameDocument:
    board = default_board()
    players = [PlayerData(name="Team 1", color="#e63946"), PlayerData(name="Team 2", color="#457b9d")]
    puzzles: Dict[str, List] = {"picture": [], "sound": [], "emoji": [], "ai": []}
    return GameDocument(board=board, puzzles=puzzles, players=players)
