import { Router, type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { requirePermission, requireAdmin } from '../middleware/authMiddleware'
import { getRequesterAccountId, getRequesterAccountType, isAdminRequest } from './requester-session-helpers'
import { installPlugin, listPlugins, setPluginEnabled, removePlugin, PLUGIN_ZIP_LIMIT } from '../services/plugins/pluginRegistry'
import { openPluginInstance, requirePluginInstance, renewPluginInstance, closePluginInstance, readPluginFile, proposePluginWrite, approvePluginWrite, applyPluginWrite, dismissPluginWrite, issuePluginMedia } from '../services/plugins/pluginHost'

export function pluginRouteError(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (error instanceof z.ZodError) { res.status(400).json({ error: '확장 요청 형식이 올바르지 않아.' }); return }
  if (error instanceof Error && 'status' in error) { res.status(Number(error.status) || 400).json({ error: error.message }); return }
  if (error instanceof multer.MulterError) { res.status(413).json({ error: '패키지는 ZIP 파일 하나, 8MB까지 올릴 수 있어.' }); return }
  next(error)
}
const router = Router()
// No legacy null-origin exception, even when Sec-Fetch-Site is absent. Never expose these methods in the iframe SDK.
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.get('Origin') === 'null' || req.get('Sec-Fetch-Site') === 'cross-site' || req.get('X-CoNAI-Plugin-Host') !== '1') { res.status(403).json({ error: '앱의 확장 호스트에서만 호출할 수 있어.' }); return }
  next()
})
router.use(requirePermission('files.view'))
const caller = (req: Request) => ({ requester: { accountId: getRequesterAccountId(req), accountType: getRequesterAccountType(req) }, sessionId: req.sessionID })
const param = (req: Request, key: string) => String(req.params[key])
router.get('/', (req, res) => res.json({ success: true, data: listPlugins(isAdminRequest(req)) }))
router.post('/install', requireAdmin, multer({ storage: multer.memoryStorage(), limits: { fileSize: PLUGIN_ZIP_LIMIT, files: 1, fields: 0 } }).single('package'), (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'ZIP 패키지를 선택해줘.' }); return }
  res.status(201).json({ success: true, data: installPlugin(req.file.buffer) })
})
router.put('/:pluginId/enabled', requireAdmin, (req, res) => {
  setPluginEnabled(param(req, 'pluginId'), z.object({ enabled: z.boolean() }).strict().parse(req.body).enabled)
  res.json({ success: true })
})
router.delete('/:pluginId', requireAdmin, (req, res) => { removePlugin(param(req, 'pluginId')); res.json({ success: true }) })
router.post('/:pluginId/pages/:pageId/instances', (req, res) => {
  const input = z.object({ files: z.array(z.string()).max(20) }).strict().parse(req.body)
  res.status(201).json({ success: true, data: openPluginInstance(param(req, 'pluginId'), param(req, 'pageId'), input.files, caller(req)) })
})
router.get('/instances/:instanceId', (req, res) => {
  const instance = requirePluginInstance(param(req, 'instanceId'), caller(req))
  res.json({ success: true, data: { expiresAt: instance.row.expires_at } })
})
router.delete('/instances/:instanceId', (req, res) => { closePluginInstance(param(req, 'instanceId'), caller(req)); res.json({ success: true }) })
router.post('/instances/:instanceId/renew', (req, res) => res.json({ success: true, data: renewPluginInstance(param(req, 'instanceId'), caller(req)) }))
router.get('/instances/:instanceId/files/:fileId', (req, res) => res.json({ success: true, data: readPluginFile(param(req, 'instanceId'), param(req, 'fileId'), caller(req)) }))
router.post('/instances/:instanceId/media/:fileId', (req, res) => res.json({ success: true, data: issuePluginMedia(param(req, 'instanceId'), param(req, 'fileId'), caller(req)) }))
router.post('/instances/:instanceId/proposals', requirePermission('files.edit'), (req, res) => res.json({ success: true, data: proposePluginWrite(param(req, 'instanceId'), req.body, caller(req)) }))
router.post('/proposals/:proposalId/approve', requirePermission('files.edit'), (req, res) => res.json({ success: true, data: approvePluginWrite(param(req, 'proposalId'), caller(req)) }))
router.post('/proposals/:proposalId/apply', requirePermission('files.edit'), (req, res) => {
  const { approval } = z.object({ approval: z.string() }).strict().parse(req.body)
  res.json({ success: true, data: applyPluginWrite(param(req, 'proposalId'), approval, caller(req)) })
})
router.delete('/proposals/:proposalId', (req, res) => { dismissPluginWrite(param(req, 'proposalId'), caller(req)); res.json({ success: true }) })
router.use(pluginRouteError)
export default router
