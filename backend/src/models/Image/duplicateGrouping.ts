import { popcount32 } from './similarityIndexSql';

/**
 * Greedy duplicate grouping over 64-bit pHashes without comparing every pair.
 *
 * Semantics are those of the original O(n²) scan: walk the candidates in order; each one not yet grouped seeds a group
 * and takes every later, not-yet-grouped candidate within `threshold` bits of the seed itself (not transitively).
 * Neighbours are found with an in-memory multi-index: the 64 bits are cut into k bands and two hashes within distance
 * t share at least one band within floor(t / k) bits, so probing those band values in each band's buckets finds every
 * neighbour; each one is then checked exactly.
 */

/** Upper bound on bucket array size per band (2^22 offsets = 16MB). */
const MAX_BAND_BITS = 22;
/** Estimated hash comparisons above which grouping refuses instead of running for minutes. */
export const DUPLICATE_GROUPING_MAX_WORK = 400_000_000;

export type BandLayout = { bands: Array<{ start: number; length: number }>; radius: number; estimatedWork: number };

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

function probesWithin(bits: number, radius: number): number {
  let total = 0;
  for (let r = 0; r <= radius; r += 1) total += binomial(bits, r);
  return total;
}

/** Cheapest band layout for `count` hashes at `threshold`, or null when even the best one is too much work. */
export function planBandLayout(count: number, threshold: number): BandLayout | null {
  let best: BandLayout | null = null;
  for (let k = 2; k <= 8; k += 1) {
    const base = Math.floor(64 / k);
    const extra = 64 % k;
    const lengths = Array.from({ length: k }, (_unused, index) => base + (index < extra ? 1 : 0));
    if (lengths[0] > MAX_BAND_BITS) continue;
    const radius = Math.floor(Math.max(0, threshold) / k);
    let work = 0;
    for (const length of lengths) {
      work += probesWithin(length, radius) * (1 + count / 2 ** length);
    }
    work *= count;
    if (!best || work < best.estimatedWork) {
      let start = 0;
      best = {
        bands: lengths.map((length) => { const band = { start, length }; start += length; return band; }),
        radius,
        estimatedWork: work,
      };
    }
  }
  return best && best.estimatedWork <= DUPLICATE_GROUPING_MAX_WORK ? best : null;
}

/** `length` bits of the 64-bit value (hi, lo) starting `start` bits from the most significant end. */
function extractBits(hi: number, lo: number, start: number, length: number): number {
  let value = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const bit = start + offset;
    const word = bit < 32 ? hi : lo;
    const shift = 31 - (bit & 31);
    value = value * 2 + ((word >>> shift) & 1);
  }
  return value;
}

function flipMasks(bits: number, radius: number): number[] {
  const masks: number[] = [0];
  const walk = (from: number, depth: number, mask: number) => {
    if (depth === 0) return;
    for (let bit = from; bit < bits; bit += 1) {
      const next = mask | (2 ** bit);
      masks.push(next);
      walk(bit + 1, depth - 1, next);
    }
  };
  walk(0, radius, 0);
  return masks;
}

export interface GroupingHooks {
  /** Called every few thousand seeds; awaited (event-loop yield, cancellation, progress). */
  onProgress?: (processed: number, total: number) => Promise<void> | void;
}

/**
 * Groups as candidate positions (seed first, then members in ascending position). Singletons are returned only when
 * `keepSingleton(position)` says so.
 */
export async function greedyDuplicateGroups(
  hi: Uint32Array,
  lo: Uint32Array,
  threshold: number,
  layout: BandLayout,
  keepSingleton: (position: number) => boolean,
  hooks: GroupingHooks = {},
): Promise<number[][]> {
  const count = hi.length;
  const bandValues: Uint32Array[] = [];
  for (const band of layout.bands) {
    const values = new Uint32Array(count);
    for (let index = 0; index < count; index += 1) {
      values[index] = extractBits(hi[index], lo[index], band.start, band.length);
      if (index % 65536 === 65535 && hooks.onProgress) await hooks.onProgress(0, count);
    }
    bandValues.push(values);
  }

  // Buckets per band in CSR form; members are filled in ascending position.
  const buckets = layout.bands.map((band, bandIndex) => {
    const size = 2 ** band.length;
    const offsets = new Int32Array(size + 1);
    const values = bandValues[bandIndex];
    for (let index = 0; index < count; index += 1) offsets[values[index] + 1] += 1;
    for (let value = 0; value < size; value += 1) offsets[value + 1] += offsets[value];
    const cursor = offsets.slice(0, size);
    const members = new Int32Array(count);
    for (let index = 0; index < count; index += 1) members[cursor[values[index]]++] = index;
    return { offsets, members, masks: flipMasks(band.length, layout.radius) };
  });

  const grouped = new Uint8Array(count);
  const seenBy = new Int32Array(count).fill(-1);
  const groups: number[][] = [];
  const threshold32 = Math.max(0, threshold);

  for (let seed = 0; seed < count; seed += 1) {
    if (seed % 4096 === 4095 && hooks.onProgress) await hooks.onProgress(seed + 1, count);
    if (grouped[seed]) continue;
    grouped[seed] = 1;
    const seedHi = hi[seed];
    const seedLo = lo[seed];
    let members: number[] | null = null;
    for (let bandIndex = 0; bandIndex < buckets.length; bandIndex += 1) {
      const { offsets, members: bucketMembers, masks } = buckets[bandIndex];
      const own = bandValues[bandIndex][seed];
      for (const mask of masks) {
        const value = own ^ mask;
        for (let at = offsets[value], end = offsets[value + 1]; at < end; at += 1) {
          const other = bucketMembers[at];
          if (other <= seed || grouped[other] || seenBy[other] === seed) continue;
          seenBy[other] = seed;
          if (popcount32(seedHi ^ hi[other]) + popcount32(seedLo ^ lo[other]) <= threshold32) {
            (members ??= []).push(other);
          }
        }
      }
    }
    if (members) {
      members.sort((left, right) => left - right);
      for (const member of members) grouped[member] = 1;
      groups.push([seed, ...members]);
    } else if (keepSingleton(seed)) {
      groups.push([seed]);
    }
  }
  if (hooks.onProgress) await hooks.onProgress(count, count);
  return groups;
}
