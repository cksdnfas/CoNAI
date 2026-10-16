import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { requireAdmin } from '../middleware/authMiddleware'
import { asyncHandler } from '../middleware/asyncHandler'
import { getRequester } from './requester-session-helpers'
import { buildPluginDraft, changePluginDraft, createPluginDraft, deletePluginDraft, exportInstalledPlugin, getPluginDraft, installPluginDraft, listPluginDrafts, pluginDraftChangeSchema, pluginDraftCreateSchema, pluginDraftInstallSchema, pluginDraftReadSchema, pluginDraftRevisionSchema, readPluginDraft, reviewPluginDraft } from '../services/plugins/pluginAuthoring'
import { pluginDraftUploadSchema, uploadPluginDraftAsset } from '../services/plugins/pluginAuthoring'
import { PLUGIN_PACKAGE_LIMITS } from '../services/plugins/pluginRegistry'

const router = Router()
router.use(requireAdmin)
const requester = (req: Request) => getRequester(req)
const sendZip = (res: Response, result: { bytes: Buffer; filename: string }) => {
  res.type('application/zip').attachment(result.filename).send(result.bytes)
}
router.get('/drafts', (req, res) => res.json({ success: true, data: listPluginDrafts(requester(req)) }))
router.post('/drafts', (req, res) => res.status(201).json({ success: true, data: createPluginDraft(requester(req), pluginDraftCreateSchema.parse(req.body)) }))
router.get('/drafts/:draftId', (req, res) => res.json({ success: true, data: getPluginDraft(requester(req), String(req.params.draftId)) }))
router.post('/read', (req, res) => res.json({ success: true, data: readPluginDraft(requester(req), pluginDraftReadSchema.parse(req.body)) }))
router.post('/changes', (req, res) => res.json({ success: true, data: changePluginDraft(requester(req), pluginDraftChangeSchema.parse(req.body)) }))
router.post('/upload', multer({ storage: multer.memoryStorage(), limits: { fileSize: PLUGIN_PACKAGE_LIMITS.file, files: 1, fields: 5, fieldSize: 250 } }).single('file'), (req, res) => {
  if (!req.file) { res.status(400).json({ error: '추가할 파일을 선택해줘.' }); return }
  const input = pluginDraftUploadSchema.parse({ ...req.body, revision: Number(req.body.revision), replace: req.body.replace === 'true' })
  res.json({ success: true, data: uploadPluginDraftAsset(requester(req), input, req.file.buffer) })
})
router.post('/review', (req, res) => {
  const input = pluginDraftRevisionSchema.parse(req.body)
  res.json({ success: true, data: reviewPluginDraft(requester(req), input.draftId, input.revision) })
})
router.post('/install', asyncHandler(async (req, res) => res.json({ success: true, data: await installPluginDraft(requester(req), pluginDraftInstallSchema.parse(req.body)) })))
router.post('/export', (req, res) => {
  const input = pluginDraftRevisionSchema.parse(req.body)
  sendZip(res, buildPluginDraft(requester(req), input.draftId, input.revision))
})
router.get('/installed/:pluginId/export', (req, res) => sendZip(res, exportInstalledPlugin(requester(req), String(req.params.pluginId))))
router.delete('/drafts/:draftId', (req, res) => {
  deletePluginDraft(requester(req), String(req.params.draftId), z.object({ revision: z.number().int().positive() }).strict().parse(req.body).revision)
  res.json({ success: true })
})
export default router
