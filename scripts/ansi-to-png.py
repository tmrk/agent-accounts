#!/usr/bin/env python3
"""Draw ANSI dashboard frames onto a pixel grid so box drawing stays aligned."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_SIZE = 16

PALETTE = {
    "bg": (0, 0, 0, 255),
    "fg": (230, 237, 243, 255),
    "dim": (139, 148, 158, 255),
    "bold": (255, 255, 255, 255),
    "red": (255, 123, 114, 255),
    "green": (63, 185, 80, 255),
    "yellow": (210, 153, 34, 255),
    "cyan": (57, 197, 207, 255),
    "white": (240, 246, 252, 255),
}

SGR_COLOR = {
    31: "red",
    32: "green",
    33: "yellow",
    36: "cyan",
    37: "white",
    90: "dim",
}

# Same-sized cells for every density so quota bars share left and right edges.
BLOCK_DENSITY = {
    "█": 1.0,
    "▓": 0.75,
    "▒": 0.45,
    "░": 0.22,
}

# Light/heavy box drawing mapped onto a cell-centered line grid.
BOX_KIND = {
    "─": "h",
    "━": "h",
    "│": "v",
    "┃": "v",
    "╭": "tl",
    "╮": "tr",
    "╰": "bl",
    "╯": "br",
    "├": "vr",
    "┤": "vl",
    "┬": "hb",
    "┴": "ht",
    "┼": "x",
}


def parse_ansi(line: str) -> list[tuple[str, dict]]:
    color = "fg"
    bold = False
    dim = False
    out: list[tuple[str, dict]] = []
    i = 0
    while i < len(line):
        if line[i] == "\x1b" and line[i:].startswith("\x1b["):
            end = line.find("m", i)
            if end == -1:
                out.append((line[i], {"color": color, "bold": bold, "dim": dim}))
                i += 1
                continue
            codes = line[i + 2 : end]
            for raw in (codes.split(";") if codes else ["0"]):
                code = int(raw or "0")
                if code == 0:
                    color, bold, dim = "fg", False, False
                elif code == 1:
                    bold = True
                elif code == 2:
                    dim = True
                elif code == 22:
                    bold = False
                    dim = False
                elif code in SGR_COLOR:
                    color = SGR_COLOR[code]
            i = end + 1
            continue
        out.append((line[i], {"color": color, "bold": bold, "dim": dim}))
        i += 1
    return out


def cell_color(style: dict) -> tuple[int, int, int, int]:
    if style["dim"]:
        return PALETTE["dim"]
    if style["bold"] and style["color"] == "fg":
        return PALETTE["bold"]
    return PALETTE[style["color"]]


def mix(fg: tuple[int, int, int, int], bg: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    return tuple(int(f * t + b * (1 - t)) for f, b in zip(fg[:3], bg[:3])) + (255,)


def measure_font(font: ImageFont.FreeTypeFont) -> tuple[int, int]:
    ascent, descent = font.getmetrics()
    cell_w = max(1, round(font.getlength("M")))
    return cell_w, ascent + descent + 4


def draw_box(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    cell_w: int,
    cell_h: int,
    kind: str,
    color: tuple[int, int, int, int],
) -> None:
    x1 = x + cell_w - 1
    y1 = y + cell_h - 1
    cx = x + cell_w // 2
    cy = y + cell_h // 2

    def hline(x0: int, x2: int) -> None:
        draw.line([(x0, cy), (x2, cy)], fill=color, width=1)

    def vline(y0: int, y2: int) -> None:
        draw.line([(cx, y0), (cx, y2)], fill=color, width=1)

    if "h" in kind or kind in {"tl", "tr", "bl", "br", "vl", "vr", "x"}:
        if kind == "h":
            hline(x, x1)
        elif kind in {"tl", "bl", "vr"}:
            hline(cx, x1)
        elif kind in {"tr", "br", "vl"}:
            hline(x, cx)
        elif kind in {"ht", "hb", "x"}:
            hline(x, x1)
    if "v" in kind or kind in {"tl", "tr", "bl", "br", "ht", "hb", "x"}:
        if kind == "v":
            vline(y, y1)
        elif kind in {"tl", "tr", "hb"}:
            vline(cy, y1)
        elif kind in {"bl", "br", "ht"}:
            vline(y, cy)
        elif kind in {"vl", "vr", "x"}:
            vline(y, y1)


def render_frame(lines: list[str], dest: Path) -> None:
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    cell_w, cell_h = measure_font(font)
    cols = max((len(parse_ansi(line)) for line in lines), default=1)
    rows = max(len(lines), 1)
    pad = 20
    im = Image.new("RGBA", (cols * cell_w + pad * 2, rows * cell_h + pad * 2), PALETTE["bg"])
    draw = ImageDraw.Draw(im)
    inset = 3
    for row, line in enumerate(lines):
        for col, (ch, style) in enumerate(parse_ansi(line)):
            x = pad + col * cell_w
            y = pad + row * cell_h
            color = cell_color(style)
            density = BLOCK_DENSITY.get(ch)
            if density is not None:
                fill = color if density >= 0.99 else mix(color, PALETTE["bg"], density)
                draw.rectangle(
                    [x, y + inset, x + cell_w - 1, y + cell_h - 1 - inset],
                    fill=fill,
                )
                continue
            kind = BOX_KIND.get(ch)
            if kind is not None:
                draw_box(draw, x, y, cell_w, cell_h, kind, color)
                continue
            if ch == " ":
                continue
            draw.text((x, y + 2), ch, font=font, fill=color, anchor="lt")
    im.save(dest)


def main() -> None:
    payload = json.load(sys.stdin)
    render_frame(payload["lines"], Path(payload["out"]))


if __name__ == "__main__":
    main()
