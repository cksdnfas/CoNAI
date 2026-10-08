/**
 * Query helpers for `media_similarity_index` (migration 042): 64-bit hashes stored as two unsigned 32-bit halves and
 * the pHash split into four 16-bit bands.
 *
 * Hamming distances are computed in SQL with a SWAR popcount, so candidate filtering runs inside SQLite and only real
 * candidates reach JS. Band probing is multi-index hashing: two 64-bit hashes within distance t agree on at least
 * one of the four 16-bit bands up to floor(t / 4) bits (pigeonhole), so probing every band value within that radius
 * finds every match; JS then re-checks each candidate exactly.
 */

export const SIMILARITY_INDEX_BAND_COUNT = 4;
export const SIMILARITY_INDEX_BAND_BITS = 16;
/**
 * Largest per-band radius worth probing: radius 3 is 697 values per band (2,788 index probes). Beyond that (t >= 16)
 * the probe lists grow past what an index search saves, and a narrow scan of the index table is used instead.
 */
export const MAX_BAND_PROBE_RADIUS = 3;

export type Hash64 = { hi: number; lo: number };

const HEX16 = /^[0-9a-fA-F]{16}$/;

/** Unsigned 32-bit halves of a 16-hex-digit hash; null for anything else (such rows have NULL halves in the index). */
export function parseHash64(value: string | null | undefined): Hash64 | null {
  if (typeof value !== 'string' || !HEX16.test(value)) {
    return null;
  }
  return { hi: parseInt(value.slice(0, 8), 16), lo: parseInt(value.slice(8, 16), 16) };
}

/** The four 16-bit bands of a hash, most significant first (matches p_b0..p_b3). */
export function hashBands(hash: Hash64): [number, number, number, number] {
  return [hash.hi >>> 16, hash.hi & 0xffff, hash.lo >>> 16, hash.lo & 0xffff];
}

export function popcount32(value: number): number {
  let v = value >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return Math.imul(v, 0x01010101) >>> 24;
}

export function hamming64(left: Hash64, right: Hash64): number {
  return popcount32(left.hi ^ right.hi) + popcount32(left.lo ^ right.lo);
}

/** Every 16-bit value within `radius` flipped bits of `band`, the band itself first. */
export function bandProbeValues(band: number, radius: number): number[] {
  const values: number[] = [band];
  const flip = (start: number, depth: number, current: number) => {
    if (depth === 0) return;
    for (let bit = start; bit < SIMILARITY_INDEX_BAND_BITS; bit += 1) {
      const next = current ^ (1 << bit);
      values.push(next);
      flip(bit + 1, depth - 1, next);
    }
  };
  flip(0, radius, band);
  return values;
}

export function bandProbeRadius(threshold: number): number {
  return Math.floor(Math.max(0, threshold) / SIMILARITY_INDEX_BAND_COUNT);
}

/** SQL popcount of a non-negative integer below 2^32 (SWAR; every intermediate fits SQLite's 64-bit integers). */
function popcount32Sql(x: string): string {
  const s1 = `(${x} - ((${x} >> 1) & 1431655765))`;
  const s2 = `((${s1} & 858993459) + ((${s1} >> 2) & 858993459))`;
  const s3 = `((${s2} + (${s2} >> 4)) & 252645135)`;
  return `(((${s3} * 16843009) & 4294967295) >> 24)`;
}

/** SQL XOR of two non-negative integers (SQLite has no XOR operator). */
function xorSql(left: string, right: string): string {
  return `((${left} | ${right}) - (${left} & ${right}))`;
}

/**
 * SQL Hamming distance between the index columns `<prefix>_hi/_lo` (on `alias`) and the named parameters
 * `@<param>_hi/_lo`.
 */
export function hammingSql(alias: string, prefix: string, param: string): string {
  return `(${popcount32Sql(xorSql(`${alias}.${prefix}_hi`, `@${param}_hi`))} + ${popcount32Sql(xorSql(`${alias}.${prefix}_lo`, `@${param}_lo`))})`;
}

export function hashParams(param: string, hash: Hash64): Record<string, number> {
  return { [`${param}_hi`]: hash.hi, [`${param}_lo`]: hash.lo };
}

/**
 * `cand(media_id)` CTE body: index rows whose pHash shares a band with the target within `radius` bits. Band value
 * lists travel as JSON arrays in `@band0`..`@band3` so the statement text stays constant.
 */
export function bandCandidateCte(): string {
  const parts = [0, 1, 2, 3].map((band) =>
    `SELECT media_id FROM media_similarity_index WHERE p_b${band} IN (SELECT value FROM json_each(@band${band}))`
  );
  return `cand(media_id) AS (\n      ${parts.join('\n      UNION\n      ')}\n    )`;
}

export function bandCandidateParams(hash: Hash64, radius: number): Record<string, string> {
  const bands = hashBands(hash);
  return Object.fromEntries(bands.map((band, index) => [`band${index}`, JSON.stringify(bandProbeValues(band, radius))]));
}
