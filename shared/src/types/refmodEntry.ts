// RefMod entries: the named RefMod definitions CoNAI manages (sources + creation workflow + field values).
// Records (minimax_refmod_records, MiniMaxH3RefModRecord) stay the run log; an entry can be built at any time
// on the default ComfyUI server and moved between instances as a bundle.

import type { MiniMaxH3RefModKind, MiniMaxH3RefModLibraryItem, MiniMaxH3RefModRecordMember, MiniMaxH3RefModRecordStatus } from './minimaxRefMod'

/** Asset reference used only inside an entry's Director value and the entry editor; it never enters a run. */
export const REFMOD_ENTRY_FILE_REF_KIND = 'refmod-entry-file'

export type RefModEntryFileRef = {
  __ref: typeof REFMOD_ENTRY_FILE_REF_KIND
  entryId: number
  /** File-store file id (one of the entry's own copies). */
  id: string
  fileName: string
  mimeType: string
  bytes: number
}

/** Why a name is not a RefMod file name DaSiWa accepts (one plain file name), or null when it is. */
export type RefModNameProblem = 'empty' | 'characters' | 'leading-dot' | 'trailing' | 'edge-space' | 'reserved' | 'too-long'

const RESERVED_REFMOD_STEMS = new Set(['CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$', ...['COM', 'LPT'].flatMap((prefix) => [...'123456789¹²³'].map((digit) => `${prefix}${digit}`))])
const UNSAFE_REFMOD_NAME_CHARS = '/\\:<>"|?*%'

/**
 * DaSiWa's dasiwa_validate_name (ComfyUI-DaSiWa-Nodes nodes/refmod_export.py), ported as is: the bundle is saved as
 * models/refmods/<name>.safetensors, so a name is one plain file name. No / \\ : < > " | ? * %, no control characters
 * (below 32 and 127–159), no leading ".", no trailing "." or space, no surrounding whitespace, not a reserved Windows
 * device name (its part before the first "." compared case-insensitively), at most 200 UTF-8 bytes. The node itself
 * accepts an empty name (it generates one); an entry always needs one.
 */
export function refModNameProblem(name: string): RefModNameProblem | null {
  if (!name) return 'empty'
  if ([...name].some((char) => UNSAFE_REFMOD_NAME_CHARS.includes(char) || char.codePointAt(0)! < 32 || (char.codePointAt(0)! >= 127 && char.codePointAt(0)! <= 159))) return 'characters'
  if (name.startsWith('.')) return 'leading-dot'
  if (name.endsWith('.') || name.endsWith(' ')) return 'trailing'
  if (name !== name.trim()) return 'edge-space'
  if (RESERVED_REFMOD_STEMS.has(name.split('.')[0].replace(/ +$/, '').toUpperCase())) return 'reserved'
  if (new TextEncoder().encode(name).length > 200) return 'too-long'
  return null
}

export const REFMOD_ENTRY_LIMITS = {
  name: 200,
  description: 2000,
  keyword: 40,
  keywords: 40,
} as const

export type RefModWorkflowIssueCode =
  | 'no-export-node'
  | 'multiple-export-nodes'
  | 'director-not-exposed'
  | 'name-not-exposed'
  | 'description-not-exposed'
  | 'concept-not-exposed'
  /** Entry-level: the entry's name is not one plain file name (a registered sub-folder path, say). */
  | 'name-not-plain'
  /** Entry-level (never on a workflow candidate): required visible inputs without a value in the entry. */
  | 'required-input-empty'

/** blocking: the entry cannot be built with this workflow (no/multiple export nodes also forbid linking it). warning: a fixed workflow value is used. */
export type RefModWorkflowIssue = {
  code: RefModWorkflowIssueCode
  severity: 'blocking' | 'warning'
  /** required-input-empty: the inputs to fill. */
  fields?: Array<{ id: string; label: string }>
}

/** Marked-field ids that carry each role, or null when the workflow does not expose it. */
export type RefModWorkflowRoles = {
  name: string | null
  description: string | null
  concept: string | null
  director: string | null
}

export type RefModWorkflowCandidate = {
  id: number
  name: string
  roles: RefModWorkflowRoles
  issues: RefModWorkflowIssue[]
  buildable: boolean
}

/** Summary of one source member, derived from the entry's Director value on save (active items, timeline order). */
export type RefModEntryMember = {
  index: number
  kind: MiniMaxH3RefModKind
  description: string
  fileId: string | null
  fileName: string | null
  mimeType: string | null
  mediaMode: 'video' | 'audio' | 'video_audio' | null
  trimStart: number | null
  trimEnd: number | null
  sourceWidth: number | null
  sourceHeight: number | null
  sourceDuration: number | null
}

export type RefModEntryRun = {
  id: number
  status: MiniMaxH3RefModRecordStatus
  error: string | null
  serverId: number
  name: string | null
  createdAt: string
}

export type RefModEntrySummary = {
  id: number
  name: string
  conceptType: string
  description: string
  keywords: string[]
  members: RefModEntryMember[]
  workflowId: number | null
  workflowName: string | null
  issues: RefModWorkflowIssue[]
  buildable: boolean
  /** A run of this entry is queued or exporting. */
  pending: boolean
  lastBuiltAt: string | null
  lastRecord: Omit<RefModEntryRun, 'name'> | null
  favorite: boolean
  revision: number
  updatedAt: string
}

export type RefModEntryForm = {
  workflow: { id: number; name: string }
  /** The workflow's visible marked fields, in the shape the generation page receives them. */
  fields: Array<Record<string, unknown>>
  /** Composed promptData keyed by field id (role fields from the entry, the rest from its stored values or defaults). */
  values: Record<string, unknown>
  roles: RefModWorkflowRoles
}

export type RefModEntryDetail = RefModEntrySummary & {
  form: RefModEntryForm | null
  /** Latest runs, newest first (at most 10). */
  records: RefModEntryRun[]
  createdAt: string
}

export type RefModEntryPage = { items: RefModEntrySummary[]; total: number; hasMore: boolean }

/** A saved record whose name no entry has (latest per name). */
export type RefModUnregisteredRecord = {
  recordId: number
  name: string
  conceptType: string
  description: string
  members: MiniMaxH3RefModRecordMember[]
  createdAt: string
}

export type RefModPresence =
  | { status: 'ok'; serverId: number; serverName: string; entries: MiniMaxH3RefModLibraryItem[] }
  | { status: 'no-server' | 'unavailable' | 'error'; message: string }

export type RefModAdoptResult = {
  created: Array<{ id: number; name: string }>
  linked: number
  skipped: Array<{ name: string; reason: string }>
}

export type RefModEntryBulkResult = { updated: number; deleted: number }

export const REFMOD_BUNDLE_DOCUMENT = 'refmods.json'
export const REFMOD_BUNDLE_FORMAT = 'conai.refmods'

export type RefModBundleAsset = { bundleFile: string; fileName: string; mimeType: string }

export type RefModBundleEntry = {
  name: string
  conceptType: string
  description: string
  keywords: string[]
  favorite: boolean
  /** The Director value with each asset as a RefModBundleAsset (null: metadata-only entry). */
  director: Record<string, unknown> | null
  members: Array<Omit<RefModEntryMember, 'fileId'>>
  extras: Array<{ id: string; label: string; type: string; value: unknown }>
}

export type RefModBundle = { format: typeof REFMOD_BUNDLE_FORMAT; version: 1; entries: RefModBundleEntry[] }

export type RefModImportResult = {
  created: number
  overwritten: number
  skipped: number
  importedFiles: number
  droppedFiles: number
}
