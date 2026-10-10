/**
 * Small caches for whole-library aggregates on request paths (counts, stats, suggestion lists).
 *
 * Two families:
 *
 * - `resolveSearchTotal` — a plain 30s TTL keyed by the exact WHERE clause + params. Search totals are per query and
 *   the answer barely moves between two consecutive requests, so a short TTL without invalidation is the contract
 *   the image search has used since HEAVY-1 (moved here so complex search shares it).
 *
 * - `AggregateCache.resolve` — keyed values that depend on whole scopes of data. Each scope has a version; an entry is
 *   fresh while every scope it read is at the version it was computed against. `library` is bumped in process from
 *   the gallery cache invalidation (ingest, delete, visibility changes). `groups` can be backed by a version source
 *   instead (the `aggregate_versions` row that triggers on groups / image_groups bump, migration 043), so every
 *   membership writer counts without each one remembering to invalidate. A scope may carry a recompute floor:
 *   during an active generation queue the library is
 *   invalidated every few seconds, and without the floor every invalidation would hand the next visitor a fresh
 *   full aggregate. Within the floor a just-invalidated entry is still served. Every entry also has a hard TTL, which
 *   bounds staleness from a writer that forgot to invalidate.
 */

export type AggregateScope = 'library' | 'groups';

const SEARCH_TOTAL_CACHE_TTL_MS = 30_000;
const SEARCH_TOTAL_CACHE_MAX_ENTRIES = 250;

type SearchTotalCacheEntry = {
  total: number;
  expiresAt: number;
};

const searchTotalCache = new Map<string, SearchTotalCacheEntry>();

/** `versionScopes`: aggregate scopes whose writes change this total (their versions join the key). */
function searchTotalCacheKey(scope: string, conditions: string[], params: unknown[], versionScopes: readonly AggregateScope[]): string {
  return JSON.stringify({ scope, conditions, params, versions: versionScopes.length ? AggregateCache.versionsOf(versionScopes) : null });
}

/** A still-fresh cached search total, without computing one. */
export function peekSearchTotal(scope: string, conditions: string[], params: unknown[], versionScopes: readonly AggregateScope[] = []): number | null {
  const cached = searchTotalCache.get(searchTotalCacheKey(scope, conditions, params, versionScopes));
  return cached && cached.expiresAt > Date.now() ? cached.total : null;
}

/**
 * Resolve a search total from cache, computing it at most once per TTL. A total that depends on group membership
 * passes `['groups']`: a group gaining or losing media is then a new key, not 30 seconds of the old count.
 */
export function resolveSearchTotal(scope: string, conditions: string[], params: unknown[], compute: () => number, versionScopes: readonly AggregateScope[] = []): number {
  const cacheKey = searchTotalCacheKey(scope, conditions, params, versionScopes);
  const now = Date.now();
  const cached = searchTotalCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.total;
  }
  if (cached) {
    searchTotalCache.delete(cacheKey);
  }

  const total = compute();
  if (searchTotalCache.size >= SEARCH_TOTAL_CACHE_MAX_ENTRIES) {
    const oldestKey = searchTotalCache.keys().next().value;
    if (oldestKey) {
      searchTotalCache.delete(oldestKey);
    }
  }
  searchTotalCache.set(cacheKey, { total, expiresAt: now + SEARCH_TOTAL_CACHE_TTL_MS });
  return total;
}

type AggregateEntry = {
  value: unknown;
  computedAt: number;
  versions: Record<AggregateScope, number>;
};

export type AggregateResolveOptions = {
  /** Scopes whose writes make this value stale. */
  scopes: readonly AggregateScope[];
  /** Hard upper bound on an entry's age. */
  ttlMs?: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

/** How long a just-invalidated entry keeps being served, per scope. */
const RECOMPUTE_FLOOR_MS: Record<AggregateScope, number> = {
  library: 10_000,
  groups: 0,
};

export class AggregateCache {
  private static entries = new Map<string, AggregateEntry>();
  private static versions: Record<AggregateScope, number> = { library: 0, groups: 0 };
  private static versionSources: Partial<Record<AggregateScope, () => number | null>> = {};

  static resolve<T>(key: string, compute: () => T, options: AggregateResolveOptions): T {
    const now = Date.now();
    const current = this.currentVersions(options.scopes);
    const entry = this.entries.get(key);
    if (entry && this.isFresh(entry, options, current, now)) {
      return entry.value as T;
    }

    const value = compute();
    if (this.entries.size >= MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.delete(key);
    this.entries.set(key, { value, computedAt: now, versions: current });
    return value;
  }

  /** Bump a scope's in-process version (used when no version source is registered or as an extra signal). */
  static invalidate(scope: AggregateScope): void {
    this.versions[scope] += 1;
  }

  /**
   * Read a scope's version from elsewhere (e.g. a database row maintained by triggers). Returning null falls back to
   * the in-process counter, which is also folded in so `invalidate` keeps working.
   */
  static setVersionSource(scope: AggregateScope, source: (() => number | null) | null): void {
    if (source) {
      this.versionSources[scope] = source;
    } else {
      delete this.versionSources[scope];
    }
  }

  /** The current versions of `scopes`, for keys of values cached elsewhere. */
  static versionsOf(scopes: readonly AggregateScope[]): number[] {
    const current = this.currentVersions(scopes);
    return scopes.map((scope) => current[scope]);
  }

  static clearAll(): void {
    this.entries.clear();
  }

  private static currentVersions(scopes: readonly AggregateScope[]): Record<AggregateScope, number> {
    const versions = { ...this.versions };
    for (const scope of scopes) {
      const external = this.versionSources[scope]?.();
      if (typeof external === 'number') {
        // Keep both signals: the external version in the high part, local invalidations in the low part.
        versions[scope] = external * 1_000_000 + this.versions[scope];
      }
    }
    return versions;
  }

  private static isFresh(
    entry: AggregateEntry,
    options: AggregateResolveOptions,
    current: Record<AggregateScope, number>,
    now: number,
  ): boolean {
    if (now - entry.computedAt >= (options.ttlMs ?? DEFAULT_TTL_MS)) {
      return false;
    }

    return options.scopes.every((scope) => {
      if (entry.versions[scope] === current[scope]) {
        return true;
      }
      // Changed since: still serve it within the scope's floor, measured from when the entry was computed.
      return now - entry.computedAt < RECOMPUTE_FLOOR_MS[scope];
    });
  }
}
