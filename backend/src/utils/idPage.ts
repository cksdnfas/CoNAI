/**
 * Paging for endpoints that return id lists ("every match"). Without a cap, "select all" over a million-image
 * library serialises millions of ids into one JSON response. Lists up to the default limit come back whole exactly
 * as before (`total` = `ids.length`, `hasMore: false`); longer ones come in pages with `hasMore` / `nextOffset`.
 */
export const ID_PAGE_DEFAULT_LIMIT = 10_000;
export const ID_PAGE_MAX_LIMIT = 50_000;

export type IdPage = { limit: number; offset: number };

export type IdPageResponse<T> = {
  ids: T[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
};

function toNonNegativeInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

/**
 * Read `id_limit` / `id_offset` from a request body or query. Dedicated names, because these endpoints are often
 * called with the same body as the paged search (whose `limit` / `page` mean something else).
 */
export function normalizeIdPage(input: { id_limit?: unknown; id_offset?: unknown } | null | undefined): IdPage {
  const limit = toNonNegativeInteger(input?.id_limit);
  const offset = toNonNegativeInteger(input?.id_offset);
  return {
    limit: limit && limit > 0 ? Math.min(limit, ID_PAGE_MAX_LIMIT) : ID_PAGE_DEFAULT_LIMIT,
    offset: offset ?? 0,
  };
}

/**
 * Build the response from rows fetched with `LIMIT limit + 1 OFFSET offset`. The extra row only signals `hasMore`;
 * the full total is counted only when the list does not fit in one page.
 */
export function buildIdPageResponse<T>(rows: T[], page: IdPage, countTotal: () => number): IdPageResponse<T> {
  const hasMore = rows.length > page.limit;
  const ids = hasMore ? rows.slice(0, page.limit) : rows;
  const total = !hasMore && page.offset === 0 ? ids.length : countTotal();
  return {
    ids,
    total,
    hasMore,
    nextOffset: hasMore ? page.offset + ids.length : null,
  };
}
