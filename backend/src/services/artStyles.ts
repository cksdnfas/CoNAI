import AdmZip from 'adm-zip'
import sharp from 'sharp'
import { z } from 'zod'
import { ART_STYLE_LIMITS, type ArtStyle, type ArtStyleBadgeCount, type ArtStyleBulkResult, type ArtStyleExport, type ArtStyleImage, type ArtStyleImportResult, type ArtStylePage, type ArtStyleSummary } from '@conai/shared'
import { getUserSettingsDb } from '../database/userSettingsDb'
import { indexArtStyleTerms } from '../database/artStyleSchema'
import type { McpRequester } from '../mcp/context'
import { MAX_UPLOAD_FILE_SIZE_BYTES } from '../middleware/upload'
import { zipEntryBytes, zipEntryKind } from '../utils/zipEntries'
import { folderWrite } from './libraryFolderStore'
import { CharacterLibraryError } from './characterLibraryError'
import { activeMediaFile } from './codex-chat/chatCardAssets'
import { requireFileStoreOwner } from './fileStoreAccess'
import { FileStoreError, FileStoreService } from './fileStoreService'
import { ensureOwnedFolder, releaseOwnedFiles, releaseOwnedFolder, resolveOwnedFile, storeOwnedFile, type OwnedFileKind } from './comfyui/refmodEntryFiles'
import { refModMediaExtension, safeMediaMime } from './comfyui/refmodRecords'
import { isWorkflowInputAssetRef, markWorkflowInputAssetForDeletion, resolveWorkflowInputAssetFilePath } from './workflowInputAssetStore'

/**
 * Art styles (그림 스타일): reference images + positive/negative prompt + title, one-line description, badges and search
 * keywords. The REST routes, the page assistant and the chat tools all go through these functions. A style owns copies
 * of its images in the shared file store ("그림 스타일/<title>/", kept while the style exists, as RefMod entries keep
 * theirs): a library pick or an upload is copied at save, so the library can change freely, and deleting the style
 * deletes its copies. The Files page cannot delete or replace a copy; one lost anyway is left out of every read.
 */
export class ArtStyleError extends CharacterLibraryError {}

export const ART_STYLE_FILE_ROOT_FOLDER = '그림 스타일'
/** The bundle's document entry; images sit beside it as `images/<style>/<n>.<ext>`. */
export const ART_STYLE_BUNDLE_DOCUMENT = 'art-styles.json'
const BUNDLE_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024

export const ART_STYLE_FILE_KIND: OwnedFileKind = {
  rootFolder: ART_STYLE_FILE_ROOT_FOLDER,
  // One folder per style: a "/" in a title is made part of the name.
  folderSegments: (title) => [title],
  table: 'art_style_files',
  ownerColumn: 'style_id',
  stagingPrefix: 'art-style-',
  logTag: '[Art style]',
  error: (message, status) => new ArtStyleError(message, status),
  messages: {
    tooLarge: '스타일 이미지가 너무 커.',
    unsupported: '스타일 이미지는 PNG·JPEG·WebP·GIF 같은 이미지여야 해.',
    noBytes: '스타일 이미지에 내용이 없어.',
    unreadable: '스타일 이미지를 읽지 못했어.',
  },
}

/** Who acts: the file-store writer key, whether library images may be read, and (REST) the requester for `file_id`. */
export type ArtStyleActor = { owner: string; canViewImages: boolean; requester?: McpRequester }
const LOCAL_ACTOR: ArtStyleActor = { owner: 'bootstrap', canViewImages: true }

const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/
const FILE_ID = /^[a-f0-9]{32}$/
const styleIdSchema = z.number().int().positive().safe()
export function artStyleId(value: unknown): number {
  return parse(styleIdSchema, typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value)
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new ArtStyleError(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  return result.data
}
/** Trimmed, each once (case-insensitive, first spelling kept). */
function termList(chars: number, count: number, label: string) {
  return z.array(z.string().regex(NO_CONTROL, `${label}에 제어 문자는 넣을 수 없어.`).trim().min(1).max(chars))
    .transform((terms) => terms.filter((term, index) => terms.findIndex((other) => other.toLowerCase() === term.toLowerCase()) === index))
    .refine((terms) => terms.length <= count, `${label}는 ${count}개까지야.`)
}
const fileIdSchema = z.string().regex(FILE_ID, '이미지 id가 올바르지 않아.')
/** One image of a write, always tagged (a file id and a library hash can look alike, so they are never told apart by form). */
const imageItemSchema = z.union([
  z.object({ id: fileIdSchema }).strict(),
  z.object({ composite_hash: z.string().trim().min(1).max(128) }).strict(),
  z.object({ file_id: fileIdSchema }).strict(),
  z.object({ __ref: z.literal('workflow-input-asset'), id: z.string().min(1).max(200), fileName: z.string().max(500), mimeType: z.string().max(200).optional(), bytes: z.number() }).passthrough(),
])
type ImageItem = z.infer<typeof imageItemSchema>
const itemKey = (item: ImageItem) => '__ref' in item ? `upload:${item.id}` : 'composite_hash' in item ? `hash:${item.composite_hash}` : 'file_id' in item ? `file:${item.file_id}` : `id:${item.id}`
const fields = {
  title: z.string().regex(NO_CONTROL, '제목에 줄바꿈이나 제어 문자는 넣을 수 없어.').trim().min(1).max(ART_STYLE_LIMITS.title),
  // One line: line breaks become spaces.
  description: z.string().transform((text) => text.replace(/\s*[\r\n]+\s*/g, ' ').trim())
    .refine((text) => NO_CONTROL.test(text), '설명에 제어 문자는 넣을 수 없어.')
    .refine((text) => text.length <= ART_STYLE_LIMITS.description, `설명은 ${ART_STYLE_LIMITS.description}자까지야.`),
  badges: termList(ART_STYLE_LIMITS.badge, ART_STYLE_LIMITS.badges, '배지'),
  keywords: termList(ART_STYLE_LIMITS.keyword, ART_STYLE_LIMITS.keywords, '검색어'),
  positive: z.string().max(ART_STYLE_LIMITS.prompt),
  negative: z.string().max(ART_STYLE_LIMITS.prompt),
  images: z.array(imageItemSchema).max(ART_STYLE_LIMITS.images)
    .refine((items) => new Set(items.map(itemKey)).size === items.length, '같은 이미지를 두 번 넣을 수 없어.'),
  favorite: z.boolean(),
}
const createFields = {
  title: fields.title,
  description: fields.description.optional(), badges: fields.badges.optional(), keywords: fields.keywords.optional(),
  positive: fields.positive.optional(), negative: fields.negative.optional(), images: fields.images.optional(), favorite: fields.favorite.optional(),
}
/** `duplicateOf`: copy that style's images into the new one (instead of `images`). */
export const artStyleCreateSchema = z.object({ ...createFields, duplicateOf: styleIdSchema.optional() }).strict()
  .refine((value) => value.duplicateOf === undefined || value.images === undefined, 'duplicateOf와 images는 함께 쓸 수 없어.')
export const artStylePatchSchema = z.object(createFields).partial().extend({ revision: styleIdSchema }).strict()
type StyleValue = Omit<z.infer<typeof artStyleCreateSchema>, 'duplicateOf'>

type StyleRow = {
  id: number; title: string; description: string; badges: string; keywords: string; positive: string; negative: string
  images: string; folder_id: string | null; favorite: number; revision: number; created_at: string; updated_at: string
}
type SummaryRow = Pick<StyleRow, 'id' | 'title' | 'description' | 'badges' | 'favorite' | 'revision' | 'updated_at'> & { cover_id: string | null; image_count: number }
/** A style's copies that are still in the store (a copy that is gone from it drops out of every read). */
const LIVE_FILES = "art_style_files f JOIN stored_file_entries e ON e.id = f.file_id AND e.deleted_at IS NULL AND e.kind = 'file'"
const SUMMARY_COLUMNS = `id, title, description, badges, favorite, revision, updated_at,
  (SELECT f.file_id FROM ${LIVE_FILES} WHERE f.style_id = art_styles.id ORDER BY f.position LIMIT 1) AS cover_id,
  (SELECT COUNT(*) FROM ${LIVE_FILES} WHERE f.style_id = art_styles.id) AS image_count`

function write<T>(run: () => T) {
  return folderWrite(run, () => new ArtStyleError('같은 이름의 스타일이 있어.', 409, undefined, 'name_conflict'))
}
const revisionConflict = (revision: number, verb: string) => new ArtStyleError(`스타일이 바뀌었어. 다시 읽고 ${verb}.`, 409, revision, 'revision_conflict')
export function artStyleRow(styleId: number): StyleRow {
  const row = getUserSettingsDb().prepare('SELECT * FROM art_styles WHERE id = ?').get(styleId) as StyleRow | undefined
  if (!row) throw new ArtStyleError('스타일을 찾을 수 없어.', 404)
  return row
}
/** The style's images in order; copies gone from the store are skipped. */
function liveImages(styleId: number): ArtStyleImage[] {
  const rows = getUserSettingsDb().prepare(`SELECT f.file_id AS id, f.name, e.mime_type AS mimeType, f.width, f.height FROM ${LIVE_FILES}
    WHERE f.style_id = ? ORDER BY f.position`).all(styleId) as Array<ArtStyleImage & { mimeType: string | null }>
  return rows.flatMap((row) => {
    const mimeType = safeMediaMime(row.mimeType, 'image')
    return mimeType ? [{ id: row.id, name: row.name, mimeType, width: row.width, height: row.height }] : []
  })
}
/** One image file a style holds (its validated MIME and path); null for any other file or one gone from the store. */
export function resolveArtStyleFile(styleId: number, fileId: string) {
  const file = resolveOwnedFile(ART_STYLE_FILE_KIND, styleId, fileId)
  return file && file.kind === 'image' ? file : null
}
function summary(row: SummaryRow, images: boolean): ArtStyleSummary {
  return {
    id: row.id, title: row.title, description: row.description, badges: JSON.parse(row.badges) as string[],
    coverImageId: images ? row.cover_id : null, imageCount: row.image_count, favorite: row.favorite === 1, revision: row.revision, updatedAt: row.updated_at,
  }
}
export function getArtStyle(styleId: number, images = true): ArtStyle {
  const row = artStyleRow(styleId)
  const held = liveImages(styleId)
  return {
    ...summary({ ...row, cover_id: held[0]?.id ?? null, image_count: held.length }, images),
    keywords: JSON.parse(row.keywords) as string[], positive: row.positive, negative: row.negative,
    images: images ? held : [], createdAt: row.created_at,
  }
}

const scopeFields = {
  query: z.string().max(200).optional(),
  favorite: z.boolean().optional(),
  badges: z.array(z.string().trim().min(1).max(ART_STYLE_LIMITS.badge)).max(ART_STYLE_LIMITS.badges).optional(),
}
const ORDER_BY = { name: 'title COLLATE NOCASE, id', updated: 'updated_at DESC, id DESC', created: 'created_at DESC, id DESC', created_asc: 'created_at, id' } as const
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`
type Scope = { query?: string; favorite?: boolean; badges?: string[] }
/** Every query term matches the title, the description, a badge or a keyword; every badge is on the style. */
function scopeWhere(scope: Scope) {
  const where: string[] = [], bindings: string[] = []
  for (const term of new Set(scope.query?.trim().split(/\s+/).filter(Boolean) ?? [])) {
    const like = likePattern(term)
    where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR id IN (SELECT style_id FROM art_style_terms WHERE term LIKE ? ESCAPE '\\'))")
    bindings.push(like, like, like)
  }
  if (scope.favorite) where.push('favorite = 1')
  for (const badge of new Set(scope.badges ?? [])) {
    where.push("id IN (SELECT style_id FROM art_style_terms WHERE kind = 'badge' AND term = ?)")
    bindings.push(badge)
  }
  return { filter: where.length ? `WHERE ${where.join(' AND ')}` : '', bindings }
}
export function listArtStyles(input: unknown = {}, images = true): ArtStylePage {
  const value = parse(z.object({
    ...scopeFields,
    sort: z.enum(['name', 'updated', 'created', 'created_asc']).default('name'),
    limit: z.number().int().min(1).max(200).default(60),
    offset: z.number().int().nonnegative().default(0),
  }).strict(), input)
  const { filter, bindings } = scopeWhere(value)
  const db = getUserSettingsDb()
  const total = (db.prepare(`SELECT COUNT(*) n FROM art_styles ${filter}`).get(...bindings) as { n: number }).n
  const rows = db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM art_styles ${filter} ORDER BY ${ORDER_BY[value.sort]} LIMIT ? OFFSET ?`).all(...bindings, value.limit, value.offset) as SummaryRow[]
  return { items: rows.map((row) => summary(row, images)), total, hasMore: value.offset + rows.length < total }
}
/** Badges on the styles of a scope (query, favorite), most used first; spellings that differ only in case count together. */
export function artStyleBadges(input: unknown = {}): ArtStyleBadgeCount[] {
  const { badges: _badges, ...badgeScope } = scopeFields
  const { filter, bindings } = scopeWhere(parse(z.object(badgeScope).strict(), input))
  return getUserSettingsDb().prepare(`SELECT term AS badge, COUNT(*) AS count FROM art_style_terms
    WHERE kind = 'badge' AND style_id IN (SELECT id FROM art_styles ${filter}) GROUP BY term ORDER BY count DESC, term`).all(...bindings) as ArtStyleBadgeCount[]
}

export function requireArtStyleImageAccess(input: unknown, canViewImages: boolean) {
  if (!canViewImages && input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'images')) {
    throw new ArtStyleError('Permission required: images.view', 403)
  }
}
function assertTitleFree(title: string, styleId = 0) {
  if (getUserSettingsDb().prepare('SELECT 1 FROM art_styles WHERE title = ? COLLATE NOCASE AND id != ?').get(title, styleId)) {
    throw new ArtStyleError('같은 이름의 스타일이 있어.', 409, undefined, 'name_conflict')
  }
}

// ---------------------------------------------------------------- images

/** What one written image becomes: one the style keeps, or a source copied into its folder at save. */
type ImagePlan =
  | { kind: 'held'; fileId: string }
  | { kind: 'copy'; filePath: string; mimeType: string; fileName: string | null; consume?: string }
type StoredImage = { fileId: string; name: string; width: number | null; height: number | null }

/**
 * Checks a write's images without copying anything: a held `{ id }` must be one of this style's live copies, a
 * library `{ composite_hash }` an existing still image (images.view), a staged upload still stored, a `{ file_id }` an
 * image file the requester may read (files.view). Proposals validate with it before anything is saved.
 */
function planImages(items: ImageItem[], styleId: number | null, actor: ArtStyleActor): ImagePlan[] {
  if (items.length && !actor.canViewImages) throw new ArtStyleError('Permission required: images.view', 403)
  return items.map((item): ImagePlan => {
    if ('__ref' in item) {
      if (!isWorkflowInputAssetRef(item)) throw new ArtStyleError('올린 이미지 정보가 올바르지 않아. 다시 올려줘.')
      const filePath = resolveWorkflowInputAssetFilePath(item)
      if (!filePath) throw new ArtStyleError('올린 이미지를 찾을 수 없어. 다시 올려줘.', 404)
      const mimeType = safeMediaMime(item.mimeType, 'image')
      if (!mimeType) throw new ArtStyleError(ART_STYLE_FILE_KIND.messages.unsupported)
      return { kind: 'copy', filePath, mimeType, fileName: item.fileName, consume: item.id }
    }
    if ('composite_hash' in item) {
      const file = activeMediaFile(item.composite_hash)
      if (!file?.mimeType.startsWith('image/')) throw new ArtStyleError(`라이브러리에서 이미지를 찾을 수 없어: ${item.composite_hash}`, 404)
      return { kind: 'copy', filePath: file.path, mimeType: file.mimeType, fileName: file.path.split(/[\\/]/).pop() ?? null }
    }
    if ('file_id' in item) {
      let resolved: ReturnType<typeof FileStoreService.resolveFile>
      try { resolved = FileStoreService.resolveFile(requireFileStoreOwner(actor.requester), item.file_id) }
      catch (error) { throw new ArtStyleError(error instanceof Error ? error.message : '파일을 찾을 수 없어.', error instanceof FileStoreError ? error.status : 404) }
      const mimeType = safeMediaMime(resolved.entry.mimeType, 'image')
      if (!mimeType) throw new ArtStyleError('이미지 파일만 넣을 수 있어.')
      return { kind: 'copy', filePath: resolved.filePath, mimeType, fileName: resolved.entry.name }
    }
    if (styleId === null || !resolveArtStyleFile(styleId, item.id)) throw new ArtStyleError(`이 스타일에 없는 이미지야: ${item.id}`, 400)
    return { kind: 'held', fileId: item.id }
  })
}

async function imageSize(source: string | Buffer) {
  try {
    const { width, height } = await sharp(source, { failOn: 'none' }).metadata()
    return { width: width ?? null, height: height ?? null }
  } catch { return { width: null, height: null } }
}

type Materialized = { images: StoredImage[]; created: string[]; consumed: string[]; folderId: string | null }
/**
 * Copies every new source into the style's folder (created on its first copy, then kept) and returns the ordered list a
 * write stores. On failure the copies made so far are deleted again.
 */
async function materializeImages(plans: ImagePlan[], style: { id: number | null; title: string; folder_id: string | null }, actor: ArtStyleActor): Promise<Materialized> {
  const result: Materialized = { images: [], created: [], consumed: [], folderId: null }
  const held = style.id === null ? new Map<string, StoredImage>() : new Map((getUserSettingsDb().prepare('SELECT file_id AS fileId, name, width, height FROM art_style_files WHERE style_id = ?')
    .all(style.id) as StoredImage[]).map((row) => [row.fileId, row]))
  try {
    for (const plan of plans) {
      if (plan.kind === 'held') {
        result.images.push(held.get(plan.fileId) ?? { fileId: plan.fileId, name: '', width: null, height: null })
        continue
      }
      result.folderId ??= ensureOwnedFolder(ART_STYLE_FILE_KIND, actor.owner, style.title, style.folder_id)
      const stored = await storeOwnedFile(ART_STYLE_FILE_KIND, actor.owner, result.folderId, { filePath: plan.filePath }, { kind: 'image', mimeType: plan.mimeType, fileName: plan.fileName })
      result.created.push(stored.fileId)
      if (plan.consume) result.consumed.push(plan.consume)
      result.images.push({ fileId: stored.fileId, name: stored.fileName, ...await imageSize(plan.filePath) })
    }
  } catch (error) {
    releaseOwnedFiles(ART_STYLE_FILE_KIND, actor.owner, result.created)
    throw error
  }
  return result
}

/** Inside the caller's transaction: the style's ordered file list becomes `images`; returns the files it no longer holds. */
function replaceStyleFiles(styleId: number, images: StoredImage[]): string[] {
  const db = getUserSettingsDb()
  const current = (db.prepare('SELECT file_id FROM art_style_files WHERE style_id = ?').all(styleId) as Array<{ file_id: string }>).map((row) => row.file_id)
  const kept = new Set(images.map((image) => image.fileId))
  db.prepare('DELETE FROM art_style_files WHERE style_id = ?').run(styleId)
  const insert = db.prepare('INSERT INTO art_style_files(style_id, file_id, position, name, width, height) VALUES (?, ?, ?, ?, ?, ?)')
  images.forEach((image, position) => insert.run(styleId, image.fileId, position, image.name, image.width, image.height))
  return current.filter((fileId) => !kept.has(fileId))
}
/** After commit: staged uploads the style took over are consumed and the copies it dropped deleted. */
function afterImagesCommitted(actor: ArtStyleActor, consumed: string[], removed: string[]) {
  for (const assetId of consumed) {
    try { markWorkflowInputAssetForDeletion(assetId) } catch (error) { console.warn('[Art style] Could not mark a consumed upload:', error) }
  }
  // A copy already gone from the store has nothing left to release.
  const live = getUserSettingsDb().prepare('SELECT 1 FROM stored_file_entries WHERE id = ? AND deleted_at IS NULL')
  releaseOwnedFiles(ART_STYLE_FILE_KIND, actor.owner, removed.filter((fileId) => live.get(fileId)))
}
/** A write that failed after copying: its copies go, and a folder it created is removed again when empty. */
function discardMaterialized(actor: ArtStyleActor, materialized: Materialized | null, previousFolder: string | null) {
  if (!materialized) return
  releaseOwnedFiles(ART_STYLE_FILE_KIND, actor.owner, materialized.created)
  if (materialized.folderId && materialized.folderId !== previousFolder) releaseOwnedFolder(ART_STYLE_FILE_KIND, actor.owner, materialized.folderId)
}

// ---------------------------------------------------------------- writes

/**
 * What a create (`styleId` null) or a change of `styleId` would store, checked like the write itself (fields, a free
 * title, each image held by the style or an existing library still image, and for a change the stored `revision`)
 * without copying or writing anything. Chat proposals validate with it before a person applies them through the same
 * REST write.
 */
export function validateArtStyleChange(styleId: number | null, input: unknown, canViewImages = true): { current: ArtStyle | null; value: Partial<StyleValue> } {
  requireArtStyleImageAccess(input, canViewImages)
  const actor = { owner: 'bootstrap', canViewImages }
  if (styleId === null) {
    const { duplicateOf: _duplicate, ...value } = parse(artStyleCreateSchema, input)
    assertTitleFree(value.title)
    if (value.images) planImages(value.images, null, actor)
    return { current: null, value }
  }
  const before = artStyleRow(styleId)
  const { revision, ...value } = parse(artStylePatchSchema, input)
  if (revision !== before.revision) throw revisionConflict(before.revision, '제안해줘')
  if (value.title !== undefined) assertTitleFree(value.title, styleId)
  if (value.images) planImages(value.images, styleId, actor)
  return { current: getArtStyle(styleId, canViewImages), value }
}

/** Inside a write: a new style row with its copies (already made). */
function insertArtStyle(value: Omit<StyleValue, 'images'>, images: Materialized | null) {
  const database = getUserSettingsDb()
  assertTitleFree(value.title)
  const badges = value.badges ?? [], keywords = value.keywords ?? []
  const styleId = Number(database.prepare('INSERT INTO art_styles(title, description, badges, keywords, positive, negative, favorite, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    value.title, value.description ?? '', JSON.stringify(badges), JSON.stringify(keywords), value.positive ?? '', value.negative ?? '', value.favorite ? 1 : 0, images?.folderId ?? null,
  ).lastInsertRowid)
  indexArtStyleTerms(database, styleId, badges, keywords)
  if (images) replaceStyleFiles(styleId, images.images)
  return styleId
}
/** A new style; `duplicateOf` copies that style's images (for people who see them). Copies first, then one write. */
export async function createArtStyle(input: unknown, actor: ArtStyleActor = LOCAL_ACTOR): Promise<ArtStyle> {
  requireArtStyleImageAccess(input, actor.canViewImages)
  const { duplicateOf, ...value } = parse(artStyleCreateSchema, input)
  assertTitleFree(value.title)
  let plans: ImagePlan[] = value.images ? planImages(value.images, null, actor) : []
  if (duplicateOf !== undefined) {
    artStyleRow(duplicateOf)
    if (actor.canViewImages) await convertLegacyStyleNow(duplicateOf)
    plans = actor.canViewImages ? liveImages(duplicateOf).flatMap((image) => {
      const file = resolveArtStyleFile(duplicateOf, image.id)
      return file ? [{ kind: 'copy' as const, filePath: file.filePath, mimeType: file.mimeType, fileName: image.name || file.entry.name }] : []
    }) : []
  }
  const materialized = plans.length ? await materializeImages(plans, { id: null, title: value.title, folder_id: null }, actor) : null
  let styleId: number
  try { styleId = write(() => insertArtStyle(value, materialized)) }
  catch (error) { discardMaterialized(actor, materialized, null); throw error }
  afterImagesCommitted(actor, materialized?.consumed ?? [], [])
  return getArtStyle(styleId, actor.canViewImages)
}
/** Only the given fields change, against `revision`; `images` replaces the list (dropped copies are deleted). */
export async function patchArtStyle(styleId: number, input: unknown, actor: ArtStyleActor = LOCAL_ACTOR): Promise<ArtStyle> {
  requireArtStyleImageAccess(input, actor.canViewImages)
  const value = parse(artStylePatchSchema, input)
  // The draft was read without the old library images: once they are copies, the save must see them first.
  if (value.images && await convertLegacyStyleNow(styleId)) throw revisionConflict(artStyleRow(styleId).revision, '저장해줘')
  const before = artStyleRow(styleId)
  if (value.revision !== before.revision) throw revisionConflict(before.revision, '저장해줘')
  if (value.title !== undefined) assertTitleFree(value.title, styleId)
  const plans = value.images ? planImages(value.images, styleId, actor) : null
  const materialized = plans ? await materializeImages(plans, before, actor) : null
  let removed: string[] = []
  try {
    write(() => {
      const current = artStyleRow(styleId)
      if (current.revision !== before.revision) throw revisionConflict(current.revision, '저장해줘')
      const title = value.title ?? current.title
      assertTitleFree(title, styleId)
      const badges = value.badges ?? JSON.parse(current.badges) as string[]
      const keywords = value.keywords ?? JSON.parse(current.keywords) as string[]
      // An image write also empties the old library list, so the startup conversion never brings it back.
      getUserSettingsDb().prepare(`UPDATE art_styles SET title = ?, description = ?, badges = ?, keywords = ?, positive = ?, negative = ?, favorite = ?,
        images = CASE WHEN ? THEN '[]' ELSE images END, folder_id = COALESCE(?, folder_id), revision = revision + 1, updated_at = datetime('now') WHERE id = ?`).run(
        title, value.description ?? current.description, JSON.stringify(badges), JSON.stringify(keywords), value.positive ?? current.positive, value.negative ?? current.negative,
        value.favorite === undefined ? current.favorite : value.favorite ? 1 : 0, materialized ? 1 : 0, materialized?.folderId ?? null, styleId)
      if (value.badges !== undefined || value.keywords !== undefined) indexArtStyleTerms(getUserSettingsDb(), styleId, badges, keywords)
      if (materialized) removed = replaceStyleFiles(styleId, materialized.images)
    })
  } catch (error) {
    discardMaterialized(actor, materialized, before.folder_id)
    throw error
  }
  afterImagesCommitted(actor, materialized?.consumed ?? [], removed)
  return getArtStyle(styleId, actor.canViewImages)
}
/** The style with its own image copies and (when nothing else is in it) its folder. */
export async function deleteArtStyle(styleId: number, revision?: number, actor: ArtStyleActor = LOCAL_ACTOR) {
  const removed = write(() => {
    const current = artStyleRow(styleId).revision
    if (revision !== undefined && revision !== current) throw revisionConflict(current, '삭제해줘')
    return removeArtStyles([styleId])
  })
  releaseRemoved(actor, removed)
  return { deleted: 1 }
}
/** Inside a write: the rows of these styles; returns what to release after commit. */
function removeArtStyles(ids: number[]) {
  const db = getUserSettingsDb()
  const list = JSON.stringify(ids)
  const fileIds = (db.prepare('SELECT file_id FROM art_style_files WHERE style_id IN (SELECT value FROM json_each(?))').all(list) as Array<{ file_id: string }>).map((row) => row.file_id)
  const folderIds = (db.prepare('SELECT folder_id FROM art_styles WHERE folder_id IS NOT NULL AND id IN (SELECT value FROM json_each(?))').all(list) as Array<{ folder_id: string }>).map((row) => row.folder_id)
  db.prepare('DELETE FROM art_style_terms WHERE style_id IN (SELECT value FROM json_each(?))').run(list)
  db.prepare('DELETE FROM art_style_files WHERE style_id IN (SELECT value FROM json_each(?))').run(list)
  const changes = db.prepare('DELETE FROM art_styles WHERE id IN (SELECT value FROM json_each(?))').run(list).changes
  return { changes, fileIds, folderIds }
}
function releaseRemoved(actor: ArtStyleActor, removed: { fileIds: string[]; folderIds: string[] }) {
  releaseOwnedFiles(ART_STYLE_FILE_KIND, actor.owner, removed.fileIds)
  for (const folderId of new Set(removed.folderIds)) releaseOwnedFolder(ART_STYLE_FILE_KIND, actor.owner, folderId)
}

const idList = z.array(styleIdSchema).min(1).max(1000)
const bulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('favorite'), ids: idList, favorite: z.boolean() }).strict(),
  z.object({ action: z.literal('delete'), ids: idList }).strict(),
])
/** One write for several listed styles (by id, without revisions: the person chose them in the list just now). */
export async function bulkArtStyles(input: unknown, actor: ArtStyleActor = LOCAL_ACTOR): Promise<ArtStyleBulkResult> {
  const value = parse(bulkSchema, input)
  const ids = [...new Set(value.ids)]
  if (value.action === 'delete') {
    const removed = write(() => {
      ids.forEach((styleId) => artStyleRow(styleId))
      return removeArtStyles(ids)
    })
    releaseRemoved(actor, removed)
    return { changed: removed.changes }
  }
  const changed = write(() => {
    ids.forEach((styleId) => artStyleRow(styleId))
    return getUserSettingsDb().prepare('UPDATE art_styles SET favorite = ?, revision = revision + 1 WHERE id IN (SELECT value FROM json_each(?)) AND favorite != ?')
      .run(value.favorite ? 1 : 0, JSON.stringify(ids), value.favorite ? 1 : 0).changes
  })
  return { changed }
}

// ---------------------------------------------------------------- bundles

/**
 * Styles as a portable bundle: the document and each style's own image files (`ids`, or `{}` for all). Copies gone from
 * the store are left out; without `images` (no `images.view`) the document names no image.
 */
export function exportArtStyles(input: unknown, images: boolean): { document: ArtStyleExport; files: Array<{ name: string; path: string }> } {
  const value = parse(z.union([z.object({ ids: idList }).strict(), z.object({}).strict()]), input ?? {})
  const rows = 'ids' in value
    ? [...new Set(value.ids)].map((styleId) => artStyleRow(styleId))
    : getUserSettingsDb().prepare('SELECT * FROM art_styles ORDER BY id').all() as StyleRow[]
  const files: Array<{ name: string; path: string }> = []
  const document: ArtStyleExport = {
    format: 'conai.art-styles',
    version: 1,
    styles: rows.map((row, styleIndex) => ({
      title: row.title, description: row.description, badges: JSON.parse(row.badges) as string[], keywords: JSON.parse(row.keywords) as string[],
      positive: row.positive, negative: row.negative, favorite: row.favorite === 1,
      images: (images ? liveImages(row.id) : []).flatMap((image) => {
        const file = resolveArtStyleFile(row.id, image.id)
        if (!file) return []
        const bundleFile = `images/${styleIndex + 1}/${files.length + 1}.${refModMediaExtension(file.mimeType)}`
        files.push({ name: bundleFile, path: file.filePath })
        return [{ bundleFile, name: image.name || file.entry.name, mimeType: file.mimeType }]
      }),
    })),
  }
  return { document, files }
}

const documentSchema = z.object({
  format: z.literal('conai.art-styles'),
  version: z.literal(1),
  styles: z.array(z.object({
    title: fields.title, description: fields.description, badges: fields.badges, keywords: fields.keywords,
    positive: fields.positive, negative: fields.negative, favorite: fields.favorite,
    images: z.array(z.object({ bundleFile: z.string().min(1).max(500), name: z.string().max(500), mimeType: z.string().max(200) }).strict()).max(ART_STYLE_LIMITS.images),
  }).strict()).max(5000),
}).strict()
/**
 * Add a bundle's styles: a taken title gets ` (2)`, ` (3)`…, and each bundled image becomes the new style's own copy in
 * the file store (no library import). An image that is missing, damaged, not a still image, or that the person may not
 * see (no `images.view`) is dropped and counted.
 */
export async function importArtStyles(input: { bundlePath: string }, actor: ArtStyleActor = LOCAL_ACTOR): Promise<ArtStyleImportResult> {
  let zip: AdmZip
  try { zip = new AdmZip(input.bundlePath) } catch { throw new ArtStyleError('ZIP 파일을 읽지 못했어. CoNAI에서 내보낸 그림 스타일 묶음인지 확인해줘.') }
  const entries = new Map(zip.getEntries().filter((entry) => zipEntryKind(entry) === 'file').map((entry) => [entry.entryName, entry] as const))
  const documentEntry = entries.get(ART_STYLE_BUNDLE_DOCUMENT)
  const documentBytes = documentEntry ? zipEntryBytes(documentEntry, BUNDLE_DOCUMENT_MAX_BYTES) : null
  if (!documentBytes) throw new ArtStyleError(`묶음에 ${ART_STYLE_BUNDLE_DOCUMENT}가 없어. CoNAI에서 내보낸 그림 스타일 묶음인지 확인해줘.`)
  let raw: unknown
  try { raw = JSON.parse(documentBytes.toString('utf8')) } catch { throw new ArtStyleError(`${ART_STYLE_BUNDLE_DOCUMENT}를 읽지 못했어.`) }
  const document = parse(documentSchema, raw)
  const result = { created: 0, renamed: 0, importedImages: 0, droppedImages: 0 }
  const taken = getUserSettingsDb().prepare('SELECT 1 FROM art_styles WHERE title = ? COLLATE NOCASE')
  for (const style of document.styles) {
    let title = style.title
    for (let copy = 2; taken.get(title); copy += 1) {
      const suffix = ` (${copy})`
      title = style.title.slice(0, ART_STYLE_LIMITS.title - suffix.length) + suffix
    }
    const materialized: Materialized = { images: [], created: [], consumed: [], folderId: null }
    try {
      for (const image of style.images) {
        const entry = actor.canViewImages ? entries.get(image.bundleFile) : undefined
        const bytes = entry ? zipEntryBytes(entry, MAX_UPLOAD_FILE_SIZE_BYTES) : null
        const mimeType = safeMediaMime(image.mimeType, 'image')
        if (!bytes || !mimeType) { result.droppedImages += 1; continue }
        try {
          materialized.folderId ??= ensureOwnedFolder(ART_STYLE_FILE_KIND, actor.owner, title, null)
          const stored = await storeOwnedFile(ART_STYLE_FILE_KIND, actor.owner, materialized.folderId, { buffer: bytes }, { kind: 'image', mimeType, fileName: image.name || null })
          materialized.created.push(stored.fileId)
          materialized.images.push({ fileId: stored.fileId, name: stored.fileName, ...await imageSize(bytes) })
          result.importedImages += 1
        } catch (error) {
          // A damaged or unreadable image (content check, size) drops that image only.
          if (!(error instanceof ArtStyleError)) console.warn(`[Art style import] Dropped ${image.bundleFile}:`, error instanceof Error ? error.message : error)
          result.droppedImages += 1
        }
      }
      write(() => insertArtStyle({ ...style, title }, materialized))
    } catch (error) {
      discardMaterialized(actor, materialized, null)
      throw error
    }
    if (title !== style.title) result.renamed += 1
    result.created += 1
  }
  return result
}

// ---------------------------------------------------------------- legacy rows

type LegacyRow = Pick<StyleRow, 'id' | 'title' | 'images' | 'folder_id'>
const LEGACY_WHERE = `images NOT IN ('', '[]') AND NOT EXISTS (SELECT 1 FROM art_style_files f WHERE f.style_id = art_styles.id)`

/**
 * One legacy style: a copy of every hash whose library file still exists and is a still image, then the old list is
 * emptied and the revision moves on (an editor that read the style before sees the change). False when the style
 * changed meanwhile (its copies are discarded); throws when copying fails.
 */
async function convertLegacyRow(row: LegacyRow): Promise<boolean> {
  const db = getUserSettingsDb()
  let materialized: Materialized | null = null
  try {
    let hashes: unknown
    try { hashes = JSON.parse(row.images) } catch { hashes = [] }
    const plans = [...new Set(Array.isArray(hashes) ? hashes.filter((hash): hash is string => typeof hash === 'string') : [])].flatMap((hash): ImagePlan[] => {
      const file = activeMediaFile(hash)
      return file?.mimeType.startsWith('image/') && safeMediaMime(file.mimeType, 'image')
        ? [{ kind: 'copy', filePath: file.path, mimeType: file.mimeType, fileName: file.path.split(/[\\/]/).pop() ?? null }] : []
    })
    materialized = await materializeImages(plans, { id: null, title: row.title, folder_id: row.folder_id }, LOCAL_ACTOR)
    const done = materialized
    const applied = db.transaction(() => {
      const current = db.prepare('SELECT images FROM art_styles WHERE id = ?').get(row.id) as { images: string } | undefined
      if (!current || current.images !== row.images || db.prepare('SELECT 1 FROM art_style_files WHERE style_id = ?').get(row.id)) return false
      replaceStyleFiles(row.id, done.images)
      db.prepare("UPDATE art_styles SET images = '[]', folder_id = COALESCE(?, folder_id), revision = revision + 1 WHERE id = ?").run(done.folderId, row.id)
      return true
    }).immediate()
    if (!applied) discardMaterialized(LOCAL_ACTOR, materialized, row.folder_id)
    return applied
  } catch (error) {
    discardMaterialized(LOCAL_ACTOR, materialized, row.folder_id)
    throw error
  }
}

/**
 * A style still listing library hashes from before images became copies is converted now, before something reads its
 * images to copy or replace them (an image save, a duplicate). True when it was converted (its revision moved on).
 */
async function convertLegacyStyleNow(styleId: number): Promise<boolean> {
  const row = getUserSettingsDb().prepare(`SELECT id, title, images, folder_id FROM art_styles WHERE id = ? AND ${LEGACY_WHERE}`).get(styleId) as LegacyRow | undefined
  if (!row) return false
  try { return await convertLegacyRow(row) } catch (error) {
    console.warn(`[Art style] Could not copy the images of style #${styleId}:`, error instanceof Error ? error.message : error)
    throw new ArtStyleError('예전 스타일 이미지를 옮기지 못했어. 잠시 뒤 다시 해줘.', 503)
  }
}

/**
 * Once, after startup: styles saved before images became copies list library hashes in `art_styles.images`. Each such
 * style without copies is converted (convertLegacyRow). A style that fails is logged and tried again on the next start;
 * one changed meanwhile is skipped.
 */
export async function convertLegacyArtStyleImages(): Promise<{ converted: number; failed: number }> {
  const rows = getUserSettingsDb().prepare(`SELECT id, title, images, folder_id FROM art_styles WHERE ${LEGACY_WHERE} ORDER BY id`).all() as LegacyRow[]
  const outcome = { converted: 0, failed: 0 }
  for (const row of rows) {
    try {
      if (await convertLegacyRow(row)) outcome.converted += 1
    } catch (error) {
      outcome.failed += 1
      console.warn(`[Art style] Could not copy the images of style #${row.id}; trying again on the next start:`, error instanceof Error ? error.message : error)
    }
  }
  return outcome
}
