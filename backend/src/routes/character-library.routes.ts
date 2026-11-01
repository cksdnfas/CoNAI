import fs from 'fs'
import express, { type Request, type Response } from 'express'
import multer from 'multer'
import { ZipArchive } from 'archiver'
import { z } from 'zod'
import { createUploadStorage, MAX_MULTIPLE_UPLOAD_TOTAL_BYTES } from '../middleware/upload'
import { CHAT_PROFILE_TEXT_LIMITS } from '@conai/shared'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin, requirePermission } from '../middleware/authMiddleware'
import { canRequesterViewImages } from '../middleware/imageAccess'
import { isRequesterAdmin, requesterPermissionKeys } from '../middleware/featureAccess'
import { getRequester } from './requester-session-helpers'
import * as library from '../services/characterLibrary'
import assetBatches, { chatProfileExpressionsRouter } from './chat-asset-batches.routes'
import { draftChatAppearance } from '../services/codex-chat/chatAppearanceDraft'
import { ChatAssetError } from '../services/codex-chat/chatAssetAccess'
import { normalizeProfileAssetHash } from '../services/codex-chat/chatProfileAssets'
import { CharacterAppearanceFillError, fillCharacterAppearance, splitAppearanceText } from '../services/characterAppearanceTags'

const router = express.Router()
const view = requirePermission('characters.view')
const edit = requirePermission('characters.edit')
const settingId = (req: Request) => library.characterId(req.params.settingId)
const folderId = (req: Request) => library.characterId(req.params.folderId)
const images = (req: Request) => canRequesterViewImages(getRequester(req))
function handle(run: (req: Request, res: Response) => unknown | Promise<unknown>, status = 200) {
  return asyncHandler(async (req, res) => {
    try { res.status(status).json({ success: true, data: await run(req, res) }) }
    catch (error) {
      res.status(error instanceof library.CharacterLibraryError || error instanceof ChatAssetError ? error.status : 400).json({
        success: false, error: error instanceof Error ? error.message : '캐릭터 라이브러리 작업을 처리하지 못했어.',
        ...(error instanceof library.CharacterLibraryError && error.revision !== undefined ? { revision: error.revision } : {}),
        ...(error instanceof library.CharacterLibraryError && error.code ? { code: error.code } : {}),
      })
    }
  })
}
const visible = (req: Request, setting: ReturnType<typeof library.getCharacterSetting>) => ({
  ...setting, ...(!images(req) ? { referenceHash: null, avatarHash: null } : {}),
  linkedProfiles: isRequesterAdmin(getRequester(req)) ? setting.linkedProfiles : [],
})
const visiblePreview = (req: Request, preview: ReturnType<typeof library.previewCharacterDelete>) => (
  isRequesterAdmin(getRequester(req)) ? preview : { ...preview, linkedProfiles: [] }
)
router.get('/folders', view, handle(() => library.listCharacterFolders()))
router.post('/folders', edit, handle((req) => library.createCharacterFolder(req.body), 201))
router.patch('/folders/:folderId', edit, handle((req) => library.patchCharacterFolder(folderId(req), req.body)))
router.get('/folders/:folderId/delete-preview', edit, handle((req) => visiblePreview(req, library.previewCharacterDelete('folder', folderId(req)))))
router.delete('/folders/:folderId', edit, handle((req) => library.deleteCharacterLibrary('folder', folderId(req))))
/** The list scope from the query string; `filters` is a JSON object of tag lists per dimension. */
const listScope = (req: Request) => ({
  ...(req.query.folderId !== undefined ? { folderId: req.query.folderId === 'root' ? null : library.characterId(req.query.folderId) } : {}),
  ...(req.query.query !== undefined ? { query: z.string().parse(req.query.query) } : {}),
  ...(req.query.favorite === '1' ? { favorite: true } : {}),
  ...(req.query.filters !== undefined ? { filters: JSON.parse(z.string().parse(req.query.filters)) } : {}),
})
router.get('/settings', view, handle((req) => library.listCharacterSettings({
  ...listScope(req),
  ...(req.query.sort !== undefined ? { sort: req.query.sort } : {}),
  ...(req.query.limit !== undefined ? { limit: Number(req.query.limit) } : {}),
  ...(req.query.offset !== undefined ? { offset: Number(req.query.offset) } : {}),
}, images(req))))
router.get('/facets', view, handle((req) => library.characterLibraryFacets(listScope(req))))
router.post('/settings/appearance-fill', edit, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await fillCharacterAppearance(req.body, images(req)) }) }
  catch (error) { res.status(error instanceof CharacterAppearanceFillError ? error.status : 400).json({ success: false, error: error instanceof Error ? error.message : '외형을 채우지 못했어.' }) }
}))
router.post('/settings/bulk', edit, handle((req) => library.bulkCharacterSettings(req.body)))
/** A ZIP of the document and its images; images are already compressed, so entries are stored. */
router.post('/settings/export', view, asyncHandler(async (req, res) => {
  let bundle: ReturnType<typeof library.exportCharacterLibrary>
  try { bundle = library.exportCharacterLibrary(req.body, images(req)) }
  catch (error) { res.status(error instanceof library.CharacterLibraryError ? error.status : 400).json({ success: false, error: error instanceof Error ? error.message : '내보내지 못했어.' }); return }
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="characters.zip"')
  res.setHeader('X-Character-Count', String(bundle.document.settings.length))
  res.setHeader('Cache-Control', 'private, no-store')
  await new Promise<void>((resolve, reject) => {
    const archive = new ZipArchive({ store: true })
    archive.once('error', reject)
    res.once('error', reject)
    res.once('close', () => { if (!res.writableFinished) { archive.abort(); resolve() } })
    res.once('finish', resolve)
    archive.pipe(res)
    archive.append(Buffer.from(JSON.stringify(bundle.document, null, 2)), { name: library.CHARACTER_BUNDLE_DOCUMENT })
    for (const file of bundle.files) archive.file(file.path, { name: file.name })
    void archive.finalize()
  })
}))
const bundleUpload = multer({ storage: createUploadStorage(MAX_MULTIPLE_UPLOAD_TOTAL_BYTES), limits: { files: 1, fields: 1, parts: 2 } }).single('file')
router.post('/settings/import', edit, (req, res, next) => {
  bundleUpload(req, res, (error) => {
    if (error) { res.status(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, error: '외형 묶음 ZIP 하나를 골라줘.' }); return }
    next()
  })
}, handle(async (req) => {
  try {
    if (!req.file) throw new library.CharacterLibraryError('외형 묶음 ZIP을 골라줘.')
    const folderId = typeof req.body?.folderId === 'string' && req.body.folderId ? library.characterId(req.body.folderId) : null
    return await library.importCharacterLibrary({ folderId, bundlePath: req.file.path }, images(req), requesterPermissionKeys(getRequester(req)).includes('images.upload'))
  } finally { if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {}) }
}, 201))
router.post('/settings/appearance-draft', edit, requireAdmin, handle(async (req, res) => {
  const value = z.object({ settingId: z.number().int().positive().nullable().optional(), name: z.string().trim().min(1), appearance: z.string().max(CHAT_PROFILE_TEXT_LIMITS.text).optional(), referenceHash: z.string().nullable().optional() }).strict().parse(req.body)
  const stored = value.settingId ? library.getCharacterSetting(value.settingId) : null
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })
  const draft = await draftChatAppearance(getRequester(req), {
    name: value.name, engine: 'llm', systemPrompt: value.appearance ?? stored?.appearance ?? value.name,
    appearance: value.appearance ?? stored?.appearance ?? '', visionEnabled: true,
    referenceHash: normalizeProfileAssetHash(value.referenceHash === undefined ? stored?.referenceHash : value.referenceHash),
  }, controller.signal)
  // Also sorted into sections, so the editor places the draft without a second request.
  return { ...draft, ...splitAppearanceText(draft.appearance) }
}))
router.get('/settings/:settingId', view, handle((req) => visible(req, library.getCharacterSetting(settingId(req), images(req)))))
router.post('/settings/from-profile', edit, requireAdmin, handle((req) => visible(req, library.saveCharacterSettingFromProfile(req.body, images(req)))))
router.post('/settings', edit, handle((req) => visible(req, library.createCharacterSetting(req.body, images(req))), 201))
router.patch('/settings/:settingId', edit, handle((req) => visible(req, library.patchCharacterSetting(settingId(req), req.body, images(req)))))
router.get('/settings/:settingId/delete-preview', edit, handle((req) => visiblePreview(req, library.previewCharacterDelete('setting', settingId(req)))))
router.delete('/settings/:settingId', edit, handle((req) => library.deleteCharacterLibrary('setting', settingId(req), req.query.revision === undefined ? undefined : library.characterId(req.query.revision))))
router.use('/settings/:settingId/asset-batches', edit, assetBatches)
router.use('/settings/:settingId/expressions', edit, chatProfileExpressionsRouter)
export default router
