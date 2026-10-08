"""Generate the synthetic inputs (videos, still PNGs, WAVs).

Run with the video-sprite-extractor venv python (needs Pillow + numpy).
Everything is seeded/deterministic; the committed inputs are the reference,
regeneration only needs to be close, not byte-identical.
"""
from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, clean_dir, setup_tool_path  # noqa: E402

SS = 4  # supersampling factor for anti-aliased shapes
SIZE = 128
FPS = 12
FRAMES = 24  # 2.0 s


def aa_layer(size: int, draw_fn) -> Image.Image:
    """Draw RGBA shapes at SS x and downsample -> anti-aliased edges."""
    big = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(big), SS)
    return big.resize((size, size), Image.Resampling.LANCZOS)


def glow_layer(size: int, cx: float, cy: float, r: float, color, peak_alpha: int, blur: float) -> Image.Image:
    layer = Image.new("RGBA", (size, size), (*color, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((cx - r, cy - r, cx + r, cy + r), fill=peak_alpha)
    mask = mask.filter(ImageFilter.GaussianBlur(blur))
    layer.putalpha(mask)
    return layer


def subject_frame(i: int, bg, palette, *, hold: int = 1, band=None) -> Image.Image:
    """One video frame: key background + glow + AA subject with near-key tints."""
    step = i // hold
    frame = Image.new("RGBA", (SIZE, SIZE), (*bg, 255))
    if band is not None:
        ImageDraw.Draw(frame).rectangle((0, SIZE - 16, SIZE, SIZE), fill=(*band, 255))
    cx = 34 + 3.0 * step
    cy = 62 + 10 * math.sin(step * 0.5)
    # soft semi-transparent glow (gaussian blurred), offset from the body
    frame.alpha_composite(glow_layer(SIZE, cx + 18, cy - 20, 16, palette["glow"], 150, 6))

    def draw(d: ImageDraw.ImageDraw, s: int) -> None:
        r = 22
        d.ellipse(((cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s),
                  fill=(*palette["outline"], 255))
        r2 = r - 3
        d.ellipse(((cx - r2) * s, (cy - r2) * s, (cx + r2) * s, (cy + r2) * s),
                  fill=(*palette["body"], 255))
        # near-key tinted patch inside the body
        d.ellipse(((cx - 8) * s, (cy - 4) * s, (cx + 6) * s, (cy + 10) * s),
                  fill=(*palette["nearkey"], 255))
        # thin diagonal stroke sticking out of the body (thin AA detail)
        d.line(((cx + 14) * s, (cy + 12) * s, (cx + 30) * s, (cy + 30) * s),
               fill=(*palette["stroke"], 255), width=2 * s)
        # small eye
        d.ellipse(((cx + 4) * s, (cy - 10) * s, (cx + 10) * s, (cy - 4) * s),
                  fill=(20, 20, 30, 255))

    frame.alpha_composite(aa_layer(SIZE, draw))
    return frame.convert("RGB")


MAGENTA_PALETTE = {
    "glow": (255, 240, 200),
    "outline": (60, 30, 70),
    "body": (240, 140, 210),     # pinkish: close-ish to magenta
    "nearkey": (235, 70, 225),   # very near magenta
    "stroke": (255, 255, 255),
}
GREEN_PALETTE = {
    "glow": (255, 240, 200),
    "outline": (30, 60, 40),
    "body": (140, 230, 140),     # greenish
    "nearkey": (60, 235, 70),    # very near green
    "stroke": (255, 255, 255),
}


def encode_mp4(frames: list[Image.Image], path: Path) -> None:
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{SIZE}x{SIZE}", "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-threads", "1",
        "-pix_fmt", "yuv420p", "-g", str(FRAMES), "-an",
        "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact",
        str(path),
    ]
    data = b"".join(frame.tobytes() for frame in frames)
    subprocess.run(command, input=data, check=True)


def make_videos(out: Path) -> None:
    encode_mp4([subject_frame(i, (255, 0, 255), MAGENTA_PALETTE) for i in range(FRAMES)],
               out / "magenta.mp4")
    encode_mp4([subject_frame(i, (0, 255, 0), GREEN_PALETTE, band=(0, 0, 255)) for i in range(FRAMES)],
               out / "green.mp4")
    # content changes only every 3rd frame -> runs of exact duplicate source frames
    encode_mp4([subject_frame(i, (255, 0, 255), MAGENTA_PALETTE, hold=3) for i in range(FRAMES)],
               out / "dupes.mp4")


# ---------------------------------------------------------------- despill unit PNGs

def despill_vectors(out: Path) -> None:
    rng = np.random.default_rng(1234)
    n = 32

    # v1: exact #FF00FF, top half of a square = magenta->white mix ramp, bottom = solid orange
    a = np.zeros((n, n, 3), np.float64)
    a[:] = (255, 0, 255)
    for x in range(8, 24):
        t = (x - 8) / 15.0  # 0..1 white coverage
        a[8:16, x] = (1 - t) * np.array([255, 0, 255]) + t * np.array([255, 255, 255])
    a[16:24, 8:24] = (255, 128, 0)
    Image.fromarray(np.rint(a).astype(np.uint8), "RGB").save(out / "despill_v1_exact_key_ramp.png")

    # v2: drifted key + noise, AA pale-pink disc slightly blurred (body alpha >= 0.9 -> "reliable")
    bg = np.array([251, 3, 247], np.float64)
    b = np.tile(bg, (n, n, 1)) + rng.integers(-3, 4, size=(n, n, 3))
    disc = Image.new("L", (n * SS, n * SS), 0)
    ImageDraw.Draw(disc).ellipse((8 * SS, 8 * SS, 24 * SS, 24 * SS), fill=255)
    cov = np.asarray(disc.resize((n, n), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.7)),
                     np.float64)[..., None] / 255.0
    pink = np.array([245, 190, 210], np.float64)
    b = cov * pink + (1 - cov) * b
    Image.fromarray(np.clip(np.rint(b), 0, 255).astype(np.uint8), "RGB").save(
        out / "despill_v2_drifted_key_soft_disc.png")

    # v3: solid dark square with one isolated bright contour pixel + separate translucent glow
    c = np.tile(np.array([252, 4, 250], np.float64), (n, n, 1))
    c[6:18, 6:18] = (30, 40, 120)
    # semi-transparent edge fringe (simulated codec fringe); the top fringe stops at x=12 so the
    # spike at (6, 9) sits on a contour next to fully transparent pixels
    c[5, 12:18] = 0.5 * np.array([30, 40, 120]) + 0.5 * np.array([252, 4, 250])
    c[18, 6:18] = 0.35 * np.array([30, 40, 120]) + 0.65 * np.array([252, 4, 250])
    # chroma-bleed row: positive raw alpha but luma says ~no coverage -> refine lowers alpha
    c[19, 6:18] = (252, 60, 250)
    c[6, 9] = (255, 255, 255)  # isolated bright spike on the visible contour -> outlier suppression
    glow = Image.new("L", (n, n), 0)
    ImageDraw.Draw(glow).ellipse((19, 19, 29, 29), fill=90)
    g = np.asarray(glow.filter(ImageFilter.GaussianBlur(2.0)), np.float64)[..., None] / 255.0
    c = g * np.array([255, 255, 255]) + (1 - g) * c
    Image.fromarray(np.clip(np.rint(c), 0, 255).astype(np.uint8), "RGB").save(
        out / "despill_v3_contour_spike_glow.png")

    # v4: wrong background (grey) -> must fail the border-ratio check
    d = np.full((n, n, 3), 128, np.uint8)
    d[12:20, 12:20] = (255, 0, 255)
    Image.fromarray(d, "RGB").save(out / "despill_v4_grey_border_fails.png")


# ---------------------------------------------------------------- normalization sheets

def figure(cell_w: int, cell_h: int, ox: int, oy: int, color, shadow: bool = True) -> Image.Image:
    cell = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(cell)
    bx = cell_w // 2 + ox
    by = cell_h - 4 + oy  # feet line
    if shadow:
        d.ellipse((bx - 7, by - 1, bx + 7, by + 2), fill=(0, 0, 0, 60))  # faint shadow (alpha 60)
    d.rectangle((bx - 5, by - 4, bx - 2, by), fill=(*color, 255))
    d.rectangle((bx + 2, by - 4, bx + 5, by), fill=(*color, 255))
    d.ellipse((bx - 6, by - 16, bx + 6, by - 3), fill=(*color, 255))
    d.ellipse((bx - 4, by - 22, bx + 4, by - 14), fill=(250, 220, 180, 255))
    d.point((bx + 6, by - 12), fill=(255, 255, 255, 128))  # half-alpha pixel
    return cell


def make_sheet(cols, rows, cw, ch, spacing, count, offsets, color, out: Path, *, edge=None, empty=None) -> None:
    w = cols * cw + (cols - 1) * spacing
    h = rows * ch + (rows - 1) * spacing
    sheet = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for i in range(count):
        c, r = i % cols, i // cols
        x, y = c * (cw + spacing), r * (ch + spacing)
        if empty is not None and i == empty:
            continue
        ox, oy = offsets[i % len(offsets)]
        cell = figure(cw, ch, ox, oy, color)
        if edge is not None and i == edge:
            ImageDraw.Draw(cell).rectangle((0, 2, 2, 8), fill=(255, 0, 0, 255))  # touches left edge
        sheet.alpha_composite(cell, (x, y))
    # put some junk into the unused trailing cells so frame_count actually matters
    for i in range(count, cols * rows):
        c, r = i % cols, i // cols
        ImageDraw.Draw(sheet).rectangle((c * (cw + spacing) + 4, r * (ch + spacing) + 4,
                                         c * (cw + spacing) + 8, r * (ch + spacing) + 8),
                                        fill=(0, 255, 255, 255))
    sheet.save(out)


def normalization_sheets(out: Path) -> None:
    make_sheet(4, 2, 32, 32, 0, 7, [(0, 0), (3, -1), (-3, -2), (2, 0), (-1, -3), (4, -2), (-4, 0)],
               (70, 110, 220), out / "norm_sheet_a_4x2_32px.png")
    make_sheet(3, 3, 24, 40, 2, 8, [(0, -6), (-2, -8), (3, -4), (1, -10), (-3, -5), (2, -7)],
               (200, 80, 60), out / "norm_sheet_b_3x3_24x40_sp2.png")
    make_sheet(2, 2, 28, 28, 0, 4, [(1, 0), (-2, -1)], (60, 170, 90),
               out / "norm_sheet_c_2x2_edge_empty.png", edge=1, empty=3)
    # 30 px wide, 3 columns, spacing 1 -> (30-2)/3 not integral -> grid error
    Image.new("RGBA", (30, 20), (0, 0, 0, 0)).save(out / "norm_sheet_bad_indivisible.png")
    Image.new("RGBA", (40, 20), (0, 0, 0, 0)).save(out / "norm_sheet_all_transparent.png")


# ---------------------------------------------------------------- audio inputs

def make_wavs(out: Path) -> None:
    def lavfi(expr: str, rate: int, duration: float, name: str, channel_layout: str | None = None) -> None:
        source = f"aevalsrc=exprs={expr}:s={rate}:d={duration}"
        if channel_layout:
            source += f":c={channel_layout}"
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", source,
             "-c:a", "pcm_s16le", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
             str(out / name)],
            check=True,
        )

    # 1.5 s exponential-ish sweep + seeded noise burst (0.8-1.0 s), mono 44.1k
    lavfi("0.35*sin(2*PI*(200*t+600*t*t))+if(between(t\\,0.8\\,1.0)\\,0.25*(2*random(0)-1)\\,0)",
          44100, 1.5, "sweep_noise_mono44k.wav")
    # 2 s stereo 48k, steady tones (low LRA -> two-pass loudnorm branch expected)
    lavfi("0.2*sin(2*PI*440*t)|0.2*sin(2*PI*660*t)", 48000, 2.0, "tones_stereo48k.wav", "stereo")
    # near-silent: -100 dBFS tone (below the -70 LUFS gate -> -inf measurement)
    lavfi("0.00001*sin(2*PI*1000*t)", 44100, 1.0, "near_silent_mono44k.wav")
    # quiet bed + full-scale clicks: big gain needed but no peak headroom -> linear volume fallback
    lavfi("0.02*sin(2*PI*300*t)+if(lt(mod(t\\,0.25)\\,0.002)\\,0.97\\,0)", 44100, 1.0, "peaky_clicks_mono44k.wav")
    # very short one-shot (0.2 s) -> exercises apad=whole_dur=0.4 + atrim back
    lavfi("0.5*sin(2*PI*880*t)*exp(-12*t)", 22050, 0.2, "short_blip_mono22k.wav")


def main() -> None:
    setup_tool_path()
    sprite_inputs = clean_dir(ROOT / "sprite" / "inputs")
    audio_inputs = clean_dir(ROOT / "audio" / "inputs")
    make_videos(sprite_inputs)
    despill_vectors(sprite_inputs)
    normalization_sheets(sprite_inputs)
    make_wavs(audio_inputs)
    print("inputs written")


if __name__ == "__main__":
    main()
