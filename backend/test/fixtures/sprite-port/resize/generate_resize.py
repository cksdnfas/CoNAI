"""Expected outputs for the batch-resize port, produced by the ORIGINAL video-sprite-extractor code.

Run with the original app's venv (Pillow), passing that app's backend dir:

    <video-sprite-extractor>/backend/.venv/Scripts/python.exe -I generate_resize.py <video-sprite-extractor>/backend

Writes inputs/*.png (synthetic, deterministic) and expected/*.png (app.image_resize._resize_image_bytes, PNG) plus
manifest.json next to this script. Nothing in the original app is modified.
"""

import hashlib
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(sys.argv[1]).resolve()))

from PIL import Image  # noqa: E402
from app.image_output import static_image_output  # noqa: E402
from app.image_resize import _resize_image_bytes  # noqa: E402


def gradient_rgba(width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height))
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            pixels[x, y] = (
                round(255 * x / (width - 1)),
                round(255 * y / (height - 1)),
                round(128 + 127 * math.sin(x * 0.7 + y * 0.3)),
                round(255 * (x + y) / (width + height - 2)),
            )
    return image


def checker_opaque(width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height))
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            on = ((x // 3) + (y // 3)) % 2 == 0
            inside = (x - width / 2) ** 2 + (y - height / 2) ** 2 < (min(width, height) / 3) ** 2
            if inside:
                pixels[x, y] = (230, 60, 40, 255)
            else:
                pixels[x, y] = (240, 240, 240, 255) if on else (30, 30, 50, 255)
    return image


def sprite_alpha(size: int) -> Image.Image:
    """Anti-aliased disc on full transparency: the case that needs premultiplied resampling."""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = image.load()
    radius = size * 0.38
    for y in range(size):
        for x in range(size):
            distance = math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2)
            coverage = max(0.0, min(1.0, radius + 0.5 - distance))
            if coverage > 0:
                pixels[x, y] = (40, 120, 230, round(255 * coverage))
    return image


CASES = [
    ("gradient_rgba", gradient_rgba(40, 30), 20, 15),
    ("checker_opaque", checker_opaque(33, 21), 50, 50),
    ("sprite_alpha", sprite_alpha(48), 24, 36),
]


def rgba_sha256(path: Path) -> str:
    with Image.open(path) as image:
        return hashlib.sha256(image.convert("RGBA").tobytes()).hexdigest()


def main() -> None:
    (HERE / "inputs").mkdir(exist_ok=True)
    (HERE / "expected").mkdir(exist_ok=True)
    output = static_image_output("png", 90)
    manifest = []
    for name, image, width, height in CASES:
        source = HERE / "inputs" / f"{name}.png"
        image.save(source, format="PNG")
        target = HERE / "expected" / f"{name}_{width}x{height}.png"
        target.write_bytes(_resize_image_bytes(source, width, height, output))
        manifest.append({
            "case": name,
            "input": f"inputs/{name}.png",
            "input_size": list(image.size),
            "width": width,
            "height": height,
            "expected": f"expected/{target.name}",
            "expected_rgba_sha256": rgba_sha256(target),
        })
    (HERE / "manifest.json").write_text(json.dumps({"pillow": Image.__version__, "cases": manifest}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
