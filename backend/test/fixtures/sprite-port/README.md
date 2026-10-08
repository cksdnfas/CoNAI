# sprite-port: port-produced fixtures (not from the original app)

The original `video-sprite-extractor` only despills magenta. Deviation D4 extends
"key colour + despill" to any single key colour, so there is no original output to
compare against. These files were produced by the CoNAI port itself, inspected by
eye (composited over dark and light grey at 3x), and then frozen as regression
fixtures. They pin the current behaviour. They do not prove it correct.

| case | input | key | despill kind |
|---|---|---|---|
| `despill_green_hue` | `av-golden/sprite/inputs/green.mp4` | `#00FF00` | `hue`: the original magenta formula re-derived per hue, `1 - max(min(on) - max(off), 0)` |
| `despill_orange_difference` | `inputs/orange.mp4` (made by `generate.ts`) | `#FF8000` | `difference`: per channel pair, key amount = `min((p_i - p_j) / (k_i - k_j))` over pairs with `k_i - k_j >= 64/255` |

Both cases use the web defaults (tolerance 0.08, softness 0.92, edge cleanup on, auto
crop on) and interval sampling every 0.25 s (D3 indices `0, 3, ..., 21`).

`manifest.json` stores the resolved options, the kept frame indices, the sizes, and
`rgba_sha256` (SHA-256 of the decoded straight RGBA sheet). The test compares that
hash, not the PNG bytes.

## What the inspection showed

- **Green.** The background goes fully transparent. The greenish disc interior is
  partly keyed, with 8x8 H.264 block steps. The original does the same on its magenta
  clip, where the pinkish interior shows the same pattern (compare
  `av-golden/sprite/sheets/despill_magenta_cleanup_on`).
- **Orange.** The background goes fully transparent and the blue disc stays opaque
  at its source colour.
  - A thin, about 1 px brownish ring remains on the 4 px soft edge.
  - Cause: the colour difference is linear in the mix, and the blue's own negative
    difference cancels the orange share, so those pixels read as opaque foreground.
  - The original magenta formula has the same limit for foregrounds of the opposite
    hue.

## Regenerate

From `backend/`:

```sh
npx tsx test/fixtures/sprite-port/generate.ts           # sheets + manifest (keeps orange.mp4)
npx tsx test/fixtures/sprite-port/generate.ts --inputs  # also re-encode orange.mp4
```

Re-inspect the sheets before committing regenerated files.

## `resize/`: batch resize parity (from the ORIGINAL app)

Unlike the despill sheets above, these ARE original outputs. `resize/generate_resize.py`, run with the original
`video-sprite-extractor` venv (Pillow 12.3.0), writes three synthetic inputs and resizes them with the original
`app.image_resize._resize_image_bytes` (LANCZOS, PNG): a downscale with a colour + alpha gradient, a non-uniform
upscale of an opaque checker, and a non-uniform resize of an anti-aliased disc on full transparency.
`resize/manifest.json` stores each case and the SHA-256 of the decoded straight RGBA output.

The port (`services/imageBatchResize/pillowResample.ts`) reproduces Pillow's resampler, so the test requires an
exact match (difference 0). For reference, sharp's `resize(kernel: 'lanczos3')` was measured against the same cases:
downscales stayed within 5/255 premultiplied, but the upscale differed by up to 119/255 (mean 26), because sharp
upsamples with an interpolator and different pixel alignment. That is why the resampler was ported.
