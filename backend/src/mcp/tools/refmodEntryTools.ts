import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { REFMOD_ENTRY_LIMITS, type RefModEntryDetail, type RefModEntrySummary } from '@conai/shared'
import type { McpRequestContext } from '../context'
import { errorResult, textResult } from '../toolResults'
import { requireContextPermission } from '../../middleware/featureAccess'
import { fileOwnerKey } from '../../services/fileStoreService'
import type { MarkedField } from '../../types/workflow'
import { visibleWorkflowFields } from '../../services/workflowHiddenFieldPolicy'
import { normalizeWorkflowNumericPromptValues } from '../../services/workflowNumericFieldPolicy'
import { describeMcpMarkedField, normalizeMcpWorkflowInputs, requireChatWorkflowInputs } from '../../services/comfyui/comfyWorkflowInputs'
import {
  adoptRefMods,
  buildRefModEntry,
  composeRefModEntryValues,
  createRefModEntry,
  deleteRefModEntry,
  getRefModEntry,
  getRefModPresence,
  listRefModEntries,
  listRefModEntryNames,
  listUnregisteredRefModRecords,
  patchRefModEntry,
  refModEntryInternals,
  RefModEntryError,
  type RefModEntryActor,
} from '../../services/comfyui/refmodEntries'
import { isRefModEntryFileRef } from '../../services/comfyui/refmodEntryFiles'
import { mcpCanViewImages } from './characterLibraryTools'

/**
 * RefMod entries through the same service as /api/refmod-entries: list, read, save (friendly ComfyUI inputs, normalised
 * like submit_generation_job), register unregistered RefMods and build. Deleting stays on the screen.
 */

const DIRECTOR_META_KEY = '__conai_minimax_h3_director'
/** Unregistered names listed at most (per kind); the screen lists every one. */
const UNREGISTERED_SHOWN = 100
const isRecord = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const parseRecord = (value: unknown): Record<string, any> => {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value.trim()) return {}
  try { const parsed = JSON.parse(value); return isRecord(parsed) ? parsed : {} } catch { return {} }
}
const timelineItemsOf = (director: Record<string, any>) => {
  const items = parseRecord(director.timeline_data).items
  return Array.isArray(items) ? items.filter(isRecord) : []
}
const assetsOf = (director: Record<string, any>): Record<string, unknown> => {
  const meta = director[DIRECTOR_META_KEY]
  return isRecord(meta) && isRecord(meta.assets) ? meta.assets : {}
}

function refModToolError(error: unknown) {
  if (error instanceof RefModEntryError) {
    const { code, revision, issues } = error.extra as { code?: string; revision?: number; issues?: Array<{ code: string; fields?: Array<{ id: string }> }> }
    const issueText = (issue: { code: string; fields?: Array<{ id: string }> }) => issue.fields?.length ? `${issue.code} (${issue.fields.map((field) => field.id).join(', ')})` : issue.code
    const details = [code, revision !== undefined ? `current revision ${revision}` : null, Array.isArray(issues) && issues.length ? `issues: ${issues.map(issueText).join(', ')}` : null].filter(Boolean)
    return errorResult(details.length ? `${error.message} (${details.join('; ')})` : error.message)
  }
  return errorResult(error)
}

async function run(action: () => unknown) {
  try { return textResult(await action()) } catch (error) { return refModToolError(error) }
}

const memberCounts = (entry: Pick<RefModEntrySummary, 'members'>) => entry.members.reduce<Record<string, number>>((counts, member) => {
  counts[member.kind] = (counts[member.kind] ?? 0) + 1
  return counts
}, {})

/** Exact, then case-insensitive (the screen's matching). */
function nameLookup(names: readonly string[]) {
  const exact = new Set(names)
  const folded = new Set(names.map((name) => name.toLowerCase()))
  return (name: string) => exact.has(name) || folded.has(name.toLowerCase())
}

/** A source as the model sees it: what it is, never the file id (it is only valid inside this entry). */
function sourceView(asset: unknown) {
  if (!isRecord(asset)) return null
  if (isRefModEntryFileRef(asset)) return { file_name: asset.fileName, mime_type: asset.mimeType, kind: asset.mimeType.split('/')[0] }
  if (typeof asset.fileName === 'string' && typeof asset.mimeType === 'string') return { file_name: asset.fileName, mime_type: asset.mimeType, kind: asset.mimeType.split('/')[0] }
  return null
}

/** The Director value in the friendly shape save_refmod_entry accepts back (media items keep their ids). */
function directorView(value: unknown) {
  if (!isRecord(value)) return value ?? null
  const timeline = parseRecord(value.timeline_data)
  const builder = parseRecord(value.builder_state ?? timeline.builder_state)
  const assets = assetsOf(value)
  const keys = ['id', 'type', 'enabled', 'slot', 'order', 'start', 'duration', 'trim_start', 'trim_end', 'source_width', 'source_height', 'source_duration', 'prompt', 'media_mode'] as const
  return {
    mode: value.mode, duration: value.duration, frame_rate: value.frame_rate,
    simple_prompt: typeof builder.simple_prompt === 'string' ? builder.simple_prompt : typeof value.prompt === 'string' ? value.prompt : '',
    refmods: Array.isArray(timeline.refmods) ? timeline.refmods : [],
    media: timelineItemsOf(value).map((item) => ({
      ...Object.fromEntries(keys.filter((key) => item[key] !== undefined).map((key) => [key, item[key]])),
      source: sourceView(assets[String(item.id ?? '')]),
    })),
  }
}

/** Any other field's value without inline media bytes. */
function valueView(value: unknown) {
  if (typeof value === 'string' && /^data:/i.test(value.trim())) return '[data URL omitted]'
  if (isRecord(value) && typeof value.dataUrl === 'string') return { file_name: value.fileName ?? null, mime_type: value.mimeType ?? null }
  return value
}

function savedView(entry: RefModEntryDetail) {
  return {
    id: entry.id, name: entry.name, concept: entry.conceptType, description: entry.description, keywords: entry.keywords,
    revision: entry.revision, favorite: entry.favorite, workflow: entry.form?.workflow ?? null,
    buildable: entry.buildable, issues: entry.issues, pending: entry.pending,
    members: entry.members.map((member) => ({ index: member.index, kind: member.kind, description: member.description, file_name: member.fileName })),
  }
}

/**
 * A Director media row that names an existing item by id and brings no new source keeps that item: its stored values
 * fill what the row leaves out, and after normalisation its own entry file goes back in place.
 */
function keepExistingSources(input: unknown, current: unknown) {
  const kept = new Map<string, { item: Record<string, any>; asset: unknown }>()
  if (!isRecord(input) || !Array.isArray(input.media) || !isRecord(current)) return { input, kept }
  const items = timelineItemsOf(current)
  const assets = assetsOf(current)
  const media = input.media.map((row: unknown) => {
    if (!isRecord(row) || typeof row.id !== 'string' || row.data_url || row.composite_hash) return row
    const item = items.find((entry) => entry.id === row.id)
    const asset = assets[row.id]
    if (!item || !isRefModEntryFileRef(asset)) return row
    kept.set(row.id, { item, asset })
    const keys = ['type', 'slot', 'order', 'enabled', 'start', 'duration', 'trim_start', 'trim_end', 'source_duration', 'source_width', 'source_height', 'prompt', 'value']
    const { source: _source, ...given } = row
    return { ...Object.fromEntries(keys.filter((key) => item[key] !== undefined).map((key) => [key, item[key]])), ...given }
  })
  return { input: { ...input, media }, kept }
}

function restoreKeptSources(value: unknown, kept: Map<string, { item: Record<string, any>; asset: unknown }>) {
  if (!kept.size || !isRecord(value)) return value
  const timeline = parseRecord(value.timeline_data)
  timeline.items = (Array.isArray(timeline.items) ? timeline.items : []).map((item: unknown) => {
    const entry = isRecord(item) ? kept.get(String(item.id)) : undefined
    return entry ? { ...entry.item, ...(item as Record<string, unknown>), ...(entry.item.media_mode ? { media_mode: entry.item.media_mode } : {}) } : item
  })
  const meta = isRecord(value[DIRECTOR_META_KEY]) ? value[DIRECTOR_META_KEY] : {}
  const assets = { ...assetsOf(value) }
  for (const [id, entry] of kept) assets[id] = entry.asset
  return { ...value, timeline_data: JSON.stringify(timeline), [DIRECTOR_META_KEY]: { ...meta, assets } }
}

/**
 * Friendly inputs for the entry's (target) workflow as form values: normalised like submit_generation_job over the
 * entry's current values, so a partial value keeps the rest. Only the fields given are returned.
 */
function entryFormValues(context: McpRequestContext, entryId: number, workflowId: number | null, inputs: Record<string, unknown>) {
  const { requireRow, makeWorkflowCache } = refModEntryInternals
  const info = makeWorkflowCache()(workflowId)
  if (!info) throw new RefModEntryError('워크플로를 연결한 다음 필드 값을 저장해줘. (workflow_id)')
  const known = new Set(info.fields.map((field) => field.id))
  const unknown = Object.keys(inputs).filter((id) => !known.has(id))
  if (unknown.length) throw new RefModEntryError(`이 워크플로에 없는 필드야: ${unknown.join(', ')}. get_refmod_entry의 fields를 봐줘.`)
  requireChatWorkflowInputs(context, info.fields, inputs)
  const current = composeRefModEntryValues(requireRow(entryId), info)
  const directorId = info.roles.roles.director
  const prepared = { ...inputs }
  let kept = new Map<string, { item: Record<string, any>; asset: unknown }>()
  if (directorId && prepared[directorId] !== undefined) {
    const result = keepExistingSources(prepared[directorId], current[directorId])
    prepared[directorId] = result.input
    kept = result.kept
  }
  // The given fields only, each defaulting to the entry's current value (never the workflow's).
  const fields = info.fields.filter((field) => known.has(field.id) && Object.prototype.hasOwnProperty.call(prepared, field.id))
    .map((field) => ({ ...field, default_value: Object.prototype.hasOwnProperty.call(current, field.id) ? current[field.id] : field.default_value }) as MarkedField)
  let normalized: Record<string, unknown>
  try {
    normalized = normalizeMcpWorkflowInputs(fields, normalizeWorkflowNumericPromptValues(fields, prepared))
  } catch (error) {
    throw new RefModEntryError(error instanceof Error ? error.message : String(error))
  }
  if (directorId && normalized[directorId] !== undefined) normalized[directorId] = restoreKeptSources(normalized[directorId], kept)
  const visible = new Set(visibleWorkflowFields(info.fields).map((field) => field.id))
  return Object.fromEntries(Object.entries(normalized).filter(([id]) => visible.has(id) && Object.prototype.hasOwnProperty.call(inputs, id)))
}

export function registerRefModEntryTools(server: McpServer, context: McpRequestContext) {
  const id = z.number().int().positive().safe()
  const actor = (): RefModEntryActor => ({ owner: fileOwnerKey(context.requester?.accountId ?? null), canViewImages: mcpCanViewImages(context) })

  server.registerTool('list_refmod_entries', {
    description: 'List RefMod entries (named RefMod definitions CoNAI builds on the default ComfyUI server): id, name, concept, description, member counts, buildable, issue codes, pending and lastBuiltAt. include_server also asks the default server (may wait about 15 s): on_server per entry, plus the unregistered RefMods (saved runs and server-only names) adopt_refmod registers. Read one with get_refmod_entry.',
    inputSchema: z.object({
      query: z.string().max(200).optional().describe('Every word must match the name, description, a keyword or a member description'),
      concept: z.string().max(40).optional().describe('Concept type, e.g. identity, style, motion, voice, generic'),
      include_server: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().nonnegative().optional(),
    }).strict(),
  }, async ({ query, concept, include_server, limit, offset }) => run(async () => {
    requireContextPermission(context, 'characters.view')
    const page = listRefModEntries({ query, concept, limit, offset })
    const presence = include_server ? await getRefModPresence() : null
    const onServer = presence?.status === 'ok' ? nameLookup(presence.entries.map((entry) => entry.name)) : null
    const items = page.items.map((entry) => ({
      id: entry.id, name: entry.name, concept: entry.conceptType, description: entry.description, members: memberCounts(entry),
      buildable: entry.buildable, issues: entry.issues.map((issue) => issue.code), pending: entry.pending, lastBuiltAt: entry.lastBuiltAt,
      ...(presence ? { on_server: onServer ? onServer(entry.name) : null } : {}),
    }))
    if (!presence) return { items, total: page.total, hasMore: page.hasMore }
    const records = listUnregisteredRefModRecords()
    const known = nameLookup([...listRefModEntryNames(), ...records.map((record) => record.name)])
    const serverOnly = presence.status === 'ok' ? presence.entries.filter((entry) => !known(entry.name)).map((entry) => entry.name) : []
    return {
      items, total: page.total, hasMore: page.hasMore,
      server: presence.status === 'ok' ? { status: 'ok', server_id: presence.serverId, server_name: presence.serverName } : { status: presence.status, message: presence.message },
      unregistered: {
        records: records.slice(0, UNREGISTERED_SHOWN).map((record) => ({ record_id: record.recordId, name: record.name, concept: record.conceptType })),
        server_only: serverOnly.slice(0, UNREGISTERED_SHOWN),
        ...(records.length > UNREGISTERED_SHOWN || serverOnly.length > UNREGISTERED_SHOWN ? { totals: { records: records.length, server_only: serverOnly.length } } : {}),
      },
    }
  }))

  server.registerTool('get_refmod_entry', {
    description: 'Read one RefMod entry: members, roles, issues, revision and its creation workflow fields (as get_workflow_details describes them) with current values. The Director value lists the sources as media items with ids. Read it before save_refmod_entry.',
    inputSchema: z.object({ entry_id: id }).strict(),
  }, async ({ entry_id }) => run(() => {
    requireContextPermission(context, 'characters.view')
    const entry = getRefModEntry(entry_id)
    const form = entry.form
    const fields = form ? visibleWorkflowFields(form.fields as unknown as MarkedField[]).map((field) => ({
      ...describeMcpMarkedField(field),
      value: field.id === form.roles.director ? directorView(form.values[field.id]) : valueView(form.values[field.id]),
    })) : []
    return {
      id: entry.id, name: entry.name, concept: entry.conceptType, description: entry.description, keywords: entry.keywords,
      favorite: entry.favorite, revision: entry.revision, workflow: form?.workflow ?? null, roles: form?.roles ?? null,
      buildable: entry.buildable, issues: entry.issues, pending: entry.pending, lastBuiltAt: entry.lastBuiltAt,
      members: entry.members.map((member) => ({ index: member.index, kind: member.kind, description: member.description, file_name: member.fileName, mime_type: member.mimeType, has_source: member.fileId !== null })),
      records: entry.records.slice(0, 5).map((record) => ({ id: record.id, status: record.status, error: record.error, created_at: record.createdAt })),
      fields,
      notes: [
        'save_refmod_entry inputs are keyed by field id. name, concept_type and description may be given as top-level arguments instead of their role fields.',
        'Giving the Director media replaces every source: list each source to keep as { id } (from media[].id) and add new ones with composite_hash or data_url.',
        'media[].prompt is that source\'s description inside the RefMod (what the picture, clip or sound shows); set it on every source.',
      ],
    }
  }))

  server.registerTool('save_refmod_entry', {
    description: 'Create (omit entry_id) or update (entry_id with revision from get_refmod_entry) a RefMod entry; saves directly and returns it with buildable and issues. inputs take the same values submit_generation_job accepts for its workflow; Director media by composite_hash (library image, needs images.view) or data_url. Director media replaces the whole source list, so read the entry first and resend every source to keep as { id }. On revision_conflict read the entry again. Deleting is only on the screen.',
    inputSchema: z.object({
      entry_id: id.optional(),
      revision: z.number().int().positive().optional(),
      name: z.string().trim().min(1).max(REFMOD_ENTRY_LIMITS.name).optional().describe('Plain file name under models/refmods: no path, no extension'),
      concept_type: z.string().trim().min(1).max(40).optional(),
      description: z.string().max(REFMOD_ENTRY_LIMITS.description).optional(),
      keywords: z.array(z.string().trim().min(1).max(REFMOD_ENTRY_LIMITS.keyword)).max(REFMOD_ENTRY_LIMITS.keywords).optional().describe('Search keywords; replaces the list'),
      workflow_id: id.nullable().optional().describe('Creation workflow (one DaSiWaH3RefModExport node); omit to keep it'),
      inputs: z.record(z.string(), z.unknown()).optional().describe('Field values keyed by field id, as in submit_generation_job'),
    }).strict(),
  }, async (args) => run(async () => {
    requireContextPermission(context, 'characters.edit')
    const who = actor()
    const metadata = {
      ...(args.concept_type !== undefined ? { conceptType: args.concept_type } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.keywords !== undefined ? { keywords: args.keywords } : {}),
    }
    if (args.entry_id === undefined) {
      if (!args.name) throw new RefModEntryError('새 RefMod에는 name이 필요해.')
      const created = await createRefModEntry({ name: args.name, ...(args.workflow_id !== undefined ? { workflowId: args.workflow_id } : {}) }, who)
      if (!Object.keys(metadata).length && !args.inputs) return savedView(created)
      try {
        const values = args.inputs ? entryFormValues(context, created.id, created.workflowId, args.inputs) : undefined
        return savedView(await patchRefModEntry(created.id, { revision: created.revision, ...metadata, ...(values ? { values } : {}) }, who))
      } catch (error) {
        // Nothing half-made stays behind: a retry would otherwise hit its own name.
        await deleteRefModEntry(created.id, who).catch(() => undefined)
        throw error
      }
    }
    if (args.revision === undefined) throw new RefModEntryError('revision이 필요해. get_refmod_entry로 지금 revision을 읽어줘.')
    const row = refModEntryInternals.requireRow(args.entry_id)
    const workflowId = args.workflow_id !== undefined ? args.workflow_id : row.workflow_id
    const values = args.inputs ? entryFormValues(context, args.entry_id, workflowId, args.inputs) : undefined
    return savedView(await patchRefModEntry(args.entry_id, {
      revision: args.revision,
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...metadata,
      ...(args.workflow_id !== undefined ? { workflowId: args.workflow_id } : {}),
      ...(values ? { values } : {}),
    }, who))
  }))

  server.registerTool('adopt_refmod', {
    description: 'Register one unregistered RefMod from list_refmod_entries (include_server) as an entry: record_id copies a saved run\'s sources; name registers that saved run, or a server-only bundle with its metadata only (no sources). Returns created ids.',
    inputSchema: z.object({
      record_id: id.optional(),
      name: z.string().trim().min(1).max(REFMOD_ENTRY_LIMITS.name).optional(),
    }).strict(),
  }, async ({ record_id, name }) => run(async () => {
    requireContextPermission(context, 'characters.edit')
    if ((record_id === undefined) === (name === undefined)) throw new RefModEntryError('record_id나 name 중 하나만 줘.')
    const record = name !== undefined ? listUnregisteredRefModRecords().find((entry) => entry.name === name) : undefined
    const input = record_id !== undefined ? { recordIds: [record_id] } : record ? { recordIds: [record.recordId] } : { names: [name!] }
    return adoptRefMods(input, actor())
  }))

  server.registerTool('build_refmod', {
    description: 'Build a RefMod entry on the default ComfyUI server; returns job_id at once. Follow it with get_generation_job; the entry shows pending until the run ends. Blocking issues and a run already pending are refused.',
    inputSchema: z.object({ entry_id: id }).strict(),
  }, async ({ entry_id }) => run(async () => {
    requireContextPermission(context, 'characters.edit')
    requireContextPermission(context, 'generation.execute')
    const result = await buildRefModEntry(entry_id, context.requester ?? { accountId: null, accountType: null })
    return { job_id: result.jobId, server_id: result.serverId, entry_id, next: 'get_generation_job' }
  }))
}
