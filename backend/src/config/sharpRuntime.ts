import sharp from 'sharp';

/**
 * sharp/libvips runtime tuning, applied once per process.
 *
 * libvips keeps an operation cache that, by default, holds up to 20 *open file
 * descriptors* for recently processed images. On Windows those descriptors lock
 * the file, so deleting or moving a just-generated image fails with
 * `EBUSY: resource busy or locked, unlink` / `rename` until the cache happens to
 * evict it. Older images delete fine only because newer work pushed them out.
 *
 * Keeping the memory/item caches at their libvips defaults preserves the useful
 * part of the cache while `files: 0` makes every pipeline hand its descriptor
 * back as soon as it finishes.
 */
const SHARP_CACHE_MEMORY_MB = 50; // libvips default
const SHARP_CACHE_ITEMS = 100; // libvips default
const SHARP_CACHE_OPEN_FILES = 0; // no cached file descriptors — see above
// Keep libvips' worker pool modest so background image processing does not starve API requests.
const SHARP_CONCURRENCY = 2;

let configured = false;

/** Apply the shared sharp settings. Safe to call from every process entry point. */
export function configureSharpRuntime(): void {
  if (configured) {
    return;
  }

  configured = true;
  sharp.concurrency(SHARP_CONCURRENCY);
  sharp.cache({
    memory: SHARP_CACHE_MEMORY_MB,
    files: SHARP_CACHE_OPEN_FILES,
    items: SHARP_CACHE_ITEMS,
  });
}
