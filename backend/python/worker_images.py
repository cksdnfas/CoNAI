"""Image decoding shared by every model in the AI worker: open once, hand the same RGB image to each model."""
from pathlib import Path

from PIL import Image, ImageOps

# Large PNGs (3456x3840) are common; draft() lets JPEG decode at a reduced scale, and nothing here needs more
# than ~1024px (largest model input is 1008).
MAX_DECODE_SIDE = 2048


def load_rgb(path: str) -> Image.Image:
    """Decode to RGB: EXIF orientation applied, transparency composited on white, file handle released."""
    file_path = Path(path).resolve()
    if not file_path.is_file():
        raise FileNotFoundError(f"Image file not found: {path}")
    with Image.open(file_path) as image:
        image.draft("RGB", (MAX_DECODE_SIDE, MAX_DECODE_SIDE))
        image = ImageOps.exif_transpose(image)
        image.load()
        if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
            rgba = image.convert("RGBA")
            canvas = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            canvas.alpha_composite(rgba)
            result = canvas.convert("RGB")
        else:
            result = image.convert("RGB")
    if max(result.size) > MAX_DECODE_SIDE:
        result.thumbnail((MAX_DECODE_SIDE, MAX_DECODE_SIDE), Image.Resampling.LANCZOS)
    return result


def pad_square(image: Image.Image, color=(255, 255, 255)) -> Image.Image:
    width, height = image.size
    side = max(width, height)
    canvas = Image.new("RGB", (side, side), color)
    canvas.paste(image, ((side - width) // 2, (side - height) // 2))
    return canvas
