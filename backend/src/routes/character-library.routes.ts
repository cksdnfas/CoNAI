import express, { type Request, type Response } from 'express'
import { z } from 'zod'
import { CHAT_PROFILE_TEXT_LIMITS } from '@conai/shared'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin, requirePermission } from '../middleware/authMiddleware'
import { canRequesterViewImages } from '../middleware/imageAccess'
import { isRequesterAdmin } from '../middleware/featureAccess'
import { getRequester } from './requester-session-helpers'
import * as library from '../services/characterLibrary'
import assetBatches, { chatProfileExpressionsRouter } from './chat-asset-batches.routes'
import { draftChatAppearance } from '../services/codex-chat/chatAppearanceDraft'
import { ChatAssetError } from '../services/codex-chat/chatAssetAccess'
import { normalizeProfileAssetHash } from '../services/codex-chat/chatProfileAssets'

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
router.get('/settings', view, handle((req) => library.listCharacterSettings({
  ...(req.query.folderId !== undefined ? { folderId: req.query.folderId === 'root' ? null : library.characterId(req.query.folderId) } : {}),
  ...(req.query.query !== undefined ? { query: z.string().parse(req.query.query) } : {}),
  ...(req.query.limit !== undefined ? { limit: Number(req.query.limit) } : {}),
  ...(req.query.offset !== undefined ? { offset: Number(req.query.offset) } : {}),
}, images(req))))
router.post('/settings/appearance-draft', edit, requireAdmin, handle(async (req, res) => {
  const value = z.object({ settingId: z.number().int().positive().nullable().optional(), name: z.string().trim().min(1), appearance: z.string().max(CHAT_PROFILE_TEXT_LIMITS.text).optional(), referenceHash: z.string().nullable().optional() }).strict().parse(req.body)
  const stored = value.settingId ? library.getCharacterSetting(value.settingId) : null
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })
  return draftChatAppearance(getRequester(req), {
    name: value.name, engine: 'llm', systemPrompt: value.appearance ?? stored?.appearance ?? value.name,
    appearance: value.appearance ?? stored?.appearance ?? '', visionEnabled: true,
    referenceHash: normalizeProfileAssetHash(value.referenceHash === undefined ? stored?.referenceHash : value.referenceHash),
  }, controller.signal)
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
