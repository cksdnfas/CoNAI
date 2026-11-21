/**
 * The queue payload key that links a ComfyUI run to a RefMod entry. Only the server writes it: enqueueGenerationJobs
 * adds it from its `refmodEntryLink` option (an entry build, or a retry copying a stored build) and refuses any payload
 * that already carries it, so no client route, MCP tool, published workflow or graph module can forge the link.
 */
export const REFMOD_ENTRY_RUN_KEY = '__conaiRefModEntry'

/** Server-issued link from an entry build to its run: the entry and each Director item's entry file. */
export type RefModEntryRunLink = { entryId: number; files: Record<string, string> }

/** A payload arrived already carrying the server-only RefMod entry link. */
export class RefModEntryLinkForgedError extends Error {
  constructor() {
    super('RefMod entry link is server-issued')
    this.name = 'RefModEntryLinkForgedError'
  }
}

export function hasRefModEntryRunKey(payload: unknown): boolean {
  return Boolean(payload) && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, REFMOD_ENTRY_RUN_KEY)
}

export function readRefModEntryRunLink(payload: Record<string, unknown>): RefModEntryRunLink | undefined {
  const value = payload[REFMOD_ENTRY_RUN_KEY] as Partial<RefModEntryRunLink> | undefined
  return value && typeof value === 'object' && typeof value.entryId === 'number' && value.files && typeof value.files === 'object'
    ? { entryId: value.entryId, files: value.files as Record<string, string> } : undefined
}
