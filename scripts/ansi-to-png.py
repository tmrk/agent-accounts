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


def measure_font(font: ImageFont.FreeTypeFont) -> tuple[int, int, int]:
    ascent, descent = font.getmetrics()
    bbox = font.getbbox("M")
    return bbox[2] - bbox[0], ascent + descent + 4, ascent


def render_frame(lines: list[str], dest: Path) -> None:
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    cell_w, cell_h, ascent = measure_font(font)
    cols = max((len(parse_ansi(line)) for line in lines), default=1)
    rows = max(len(lines), 1)
    pad = 20
    im = Image.new("RGBA", (cols * cell_w + pad * 2, rows * cell_h + pad * 2), PALETTE["bg"])
    draw = ImageDraw.Draw(im)
    for row, line in enumerate(lines):
        for col, (ch, style) in enumerate(parse_ansi(line)):
            if ch == " ":
                continue
            draw.text(
                (pad + col * cell_w, pad + row * cell_h + ascent),
                ch,
                font=font,
                fill=cell_color(style),
            )
    im.save(dest)


def main() -> None:
    payload = json.load(sys.stdin)
    render_frame(payload["lines"], Path(payload["out"]))


if __name__ == "__main__":
    main()
