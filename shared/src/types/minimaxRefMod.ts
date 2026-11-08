// MiniMax H3 RefMod contract shared by the DaSiWa Director node editor, the
// backend workflow-input normalizer, the RefMod library proxy and MCP tools.
// Row shape mirrors ComfyUI-DaSiWa-Nodes `timeline_data.refmods`; library
// entries mirror its `GET /dasiwa/refmods` response.

export const MINIMAX_H3_REFMOD_MAX_SLOTS = 8
export const MINIMAX_H3_REFMOD_CONCEPT_TYPES = ['generic', 'identity', 'style', 'motion', 'audio'] as const
export const MINIMAX_H3_REFMOD_KINDS = ['image', 'video', 'audio'] as const
export const MINIMAX_H3_REFMOD_EXPORT_CLASS_TYPE = 'DaSiWaH3RefModExport'
export const MINIMAX_H3_REFMOD_LIBRARY_PATH = '/dasiwa/refmods'

export type MiniMaxH3RefModConceptType = typeof MINIMAX_H3_REFMOD_CONCEPT_TYPES[number]
export type MiniMaxH3RefModKind = typeof MINIMAX_H3_REFMOD_KINDS[number]

/** One Director RefMod slot. `name` is the file path under models/refmods without extension, using `/`. */
export type MiniMaxH3RefModRow = {
  slot: number
  name: string
  enabled: boolean
  strength: number
  description: string
}

export type MiniMaxH3RefModLibraryMember = {
  kind: MiniMaxH3RefModKind
  description: string
}

/** Metadata-only library entry; no tensors are read for it. */
export type MiniMaxH3RefModLibraryEntry = {
  name: string
  kind: MiniMaxH3RefModKind
  kinds: MiniMaxH3RefModKind[]
  members: MiniMaxH3RefModLibraryMember[]
  concept: string
  description: string
  tokens: number | null
  mtime: number
}

export type MiniMaxH3RefModIssue =
  | { code: 'too-many-rows'; max: number }
  | { code: 'invalid-slot'; slot: unknown }
  | { code: 'duplicate-slot'; slot: number }
  | { code: 'missing-name'; slot: number }
  | { code: 'invalid-strength'; slot: number; strength: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isKind(value: unknown): value is MiniMaxH3RefModKind {
  return typeof value === 'string' && (MINIMAX_H3_REFMOD_KINDS as readonly string[]).includes(value)
}

/**
 * Coerce raw rows into the shared shape without clamping, so validation can
 * report what the DaSiWa node would reject. Non-object entries are dropped.
 */
export function normalizeMiniMaxH3RefModRows(value: unknown): MiniMaxH3RefModRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((row) => ({
    slot: Number(row.slot),
    name: typeof row.name === 'string' ? row.name.trim() : '',
    enabled: row.enabled !== false,
    // DaSiWa defaults a missing strength to 1 but rejects `null` (`float(None)`), so keep null invalid.
    strength: row.strength === undefined ? 1 : row.strength === null ? Number.NaN : Number(row.strength),
    description: typeof row.description === 'string' ? row.description : '',
  }))
}

/** Same rules as the DaSiWa Director `_load_refmod_rows`: ≤8 unique slots 1–8; enabled rows need a name and strength 0–1. */
export function validateMiniMaxH3RefModRows(rows: MiniMaxH3RefModRow[]): MiniMaxH3RefModIssue[] {
  const issues: MiniMaxH3RefModIssue[] = []
  if (rows.length > MINIMAX_H3_REFMOD_MAX_SLOTS) issues.push({ code: 'too-many-rows', max: MINIMAX_H3_REFMOD_MAX_SLOTS })
  const seen = new Set<number>()
  for (const row of rows) {
    if (!Number.isInteger(row.slot) || row.slot < 1 || row.slot > MINIMAX_H3_REFMOD_MAX_SLOTS) {
      issues.push({ code: 'invalid-slot', slot: row.slot })
      continue
    }
    if (seen.has(row.slot)) {
      issues.push({ code: 'duplicate-slot', slot: row.slot })
      continue
    }
    seen.add(row.slot)
    if (!row.enabled) continue
    if (!row.name) issues.push({ code: 'missing-name', slot: row.slot })
    if (!Number.isFinite(row.strength) || row.strength < 0 || row.strength > 1) {
      issues.push({ code: 'invalid-strength', slot: row.slot, strength: row.strength })
    }
  }
  return issues
}

/** Rows the Director will actually load in REF2VA: enabled, named, strength above zero, slot order. */
export function getActiveMiniMaxH3RefModRows(rows: MiniMaxH3RefModRow[]): MiniMaxH3RefModRow[] {
  return rows
    .filter((row) => row.enabled && row.name.length > 0 && row.strength > 0)
    .sort((left, right) => left.slot - right.slot)
}

/** Lowest unused slot number, or null when all eight are taken. */
export function getFreeMiniMaxH3RefModSlot(rows: MiniMaxH3RefModRow[]): number | null {
  const used = new Set(rows.map((row) => row.slot))
  for (let slot = 1; slot <= MINIMAX_H3_REFMOD_MAX_SLOTS; slot++) {
    if (!used.has(slot)) return slot
  }
  return null
}

/** Validate one `GET /dasiwa/refmods` response entry; unknown extra keys are ignored. */
export function parseMiniMaxH3RefModLibraryEntry(value: unknown): MiniMaxH3RefModLibraryEntry | null {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name) return null
  const members = Array.isArray(value.members)
    ? value.members.filter(isRecord).flatMap((member) => isKind(member.kind)
      ? [{ kind: member.kind, description: typeof member.description === 'string' ? member.description : '' }]
      : [])
    : []
  const kinds = Array.isArray(value.kinds) ? value.kinds.filter(isKind) : members.map((member) => member.kind)
  const kind = isKind(value.kind) ? value.kind : kinds[0]
  if (!kind) return null
  const tokens = Number(value.tokens)
  return {
    name: value.name,
    kind,
    kinds,
    members,
    concept: typeof value.concept === 'string' && value.concept ? value.concept : 'generic',
    description: typeof value.description === 'string' ? value.description : '',
    tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : null,
    mtime: Number.isFinite(Number(value.mtime)) ? Number(value.mtime) : 0,
  }
}
