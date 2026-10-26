#!/usr/bin/env python3
"""生成应用图标和菜单栏图标。"""

import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build")
os.makedirs(OUT, exist_ok=True)

FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def font(size):
    return ImageFont.truetype(FONT, size)


def icon():
    image = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((64, 64, 960, 960), radius=220, fill=(28, 25, 22, 255))
    face = font(560)
    draw.text((512, 470), "A", fill=(246, 244, 239, 255), font=face, anchor="mm")
    image.save(os.path.join(OUT, "icon.png"))


def tray(filename, fill, glyph):
    image = Image.new("RGBA", (44, 44), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if fill is not None:
        draw.rounded_rectangle((2, 2, 42, 42), radius=10, fill=fill)
    face = font(28)
    draw.text((22, 20), "A", fill=glyph, font=face, anchor="mm")
    image.save(os.path.join(OUT, filename))


icon()
tray("trayTemplate.png", None, (0, 0, 0, 255))
tray("trayColor.png", (28, 25, 22, 255), (246, 244, 239, 255))
print("icons ok")
