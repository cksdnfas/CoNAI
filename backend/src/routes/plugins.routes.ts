import { Router, type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { requireAdmin, requirePermission } from '../middleware/authMiddleware'
import { getRequesterAccountId, getRequesterAccountType, isAdminRequest } from './requester-session-helpers'
import { getPlugin, installPlugin, listPlugins, setPluginEnabled, removePlugin, PLUGIN_ZIP_LIMIT } from '../services/plugins/pluginRegistry'
import { openPluginInstance, requirePluginInstance, renewPluginInstance, closePluginInstance, readPluginFile, proposePluginWrite, approvePluginWrite, applyPluginWrite, dismissPluginWrite, issuePluginMedia } from '../services/plugins/pluginHost'
import { asyncHandler, cancellableAsyncHandler } from '../middleware/asyncHandler'
import { pluginStorage } from '../services/plugins/pluginStorage'
import { issuePluginArtifactMedia } from '../services/plugins/pluginArtifactMedia'
import { statPluginWorkspace, proposePluginWorkspaceChanges, listPluginWorkspace, readPluginWorkspace, proposePluginWorkspaceWrite, approvePluginWorkspaceWrite, applyPluginWorkspaceWrite, dismissPluginWorkspaceWrite, issuePluginWorkspaceMedia } from '../services/plugins/pluginWorkspace'

export function pluginRouteError(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (error instanceof z.ZodError) {
    const issues = error.issues.slice(0, 10).map(issue => ({ path: issue.path.join('.'), message: issue.message }))
    res.status(400).json({ code: 'INVALID_INPUT', error: issues.map(issue => `${issue.path || 'input'}: ${issue.message}`).join('; ').slice(0, 1500), issues }); return
  }
  if (error instanceof Error && 'status' in error) { res.status(Number(error.status) || 400).json({ error: error.message }); return }
  if (error instanceof multer.MulterError) { res.status(413).json({ error: '패키지는 ZIP 파일 하나, 8MB까지 올릴 수 있어.' }); return }
  next(error)
}
import { proposePluginMedia, approvePluginMedia, applyPluginMedia, dismissPluginMedia } from '../services/plugins/pluginMediaProcessing'
import { pluginServerStatus, requestPluginServer, runGenerationActionHook } from '../services/plugins/pluginServerRuntime'
import { CHAT_PAGE_LIMITS, GENERATION_LAYOUT_SURFACES, type InstalledPlugin } from '@conai/shared'
import { pluginInstanceAppContext, pluginBrowserContext, listPluginAppTools, runPluginAppTool, runPluginServerAction, listPluginAppRequests, getPluginAppRequest, applyPluginAppRequest, cancelPluginAppRequest } from '../services/plugins/pluginAppActions'

const router = Router()
// No legacy null-origin exception, even when Sec-Fetch-Site is absent. Never expose these methods in the iframe SDK.
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.get('Origin') === 'null' || req.get('Sec-Fetch-Site') === 'cross-site' || req.get('X-CoNAI-Plugin-Host') !== '1') { res.status(403).json({ error: '앱의 확장 호스트에서만 호출할 수 있어.' }); return }
  next()
})
const caller = (req: Request) => ({ requester: { accountId: getRequesterAccountId(req), accountType: getRequesterAccountType(req) }, sessionId: req.sessionID })
const param = (req: Request, key: string) => String(req.params[key])
const baseUrl = (req: Request) => `${req.protocol}://${req.get('host')}`
router.post('/app-tools', asyncHandler(async (req, res) => res.json({ success: true, data: await listPluginAppTools(null, pluginBrowserContext(caller(req), baseUrl(req)), req.body) })))
router.get('/app-requests', (req, res) => {
  const filter = { pending: req.query.status === 'pending', ...(typeof req.query.ids === 'string' ? { ids: req.query.ids.split(',') } : {}) }
  res.json({ success: true, data: listPluginAppRequests(pluginBrowserContext(caller(req)), z.coerce.number().int().min(0).max(1000).parse(req.query.offset ?? 0), filter) })
})
router.get('/app-requests/:requestId', (req, res) => res.json({ success: true, data: getPluginAppRequest(param(req, 'requestId'), pluginBrowserContext(caller(req)), true) }))
router.post('/app-requests/:requestId/apply', (req, res) => res.json({ success: true, data: applyPluginAppRequest(param(req, 'requestId'), caller(req)) }))
router.post('/app-requests/:requestId/cancel', (req, res) => res.json({ success: true, data: cancelPluginAppRequest(param(req, 'requestId'), pluginBrowserContext(caller(req)), true) }))
router.post('/instances/:instanceId/app/tools', asyncHandler(async (req, res) => {
  const bound = pluginInstanceAppContext(param(req, 'instanceId'), caller(req), baseUrl(req))
  res.json({ success: true, data: await listPluginAppTools(bound.pluginId, bound.context, req.body) })
}))
router.post('/instances/:instanceId/app/call', cancellableAsyncHandler(async (req, res, signal) => {
  const bound = pluginInstanceAppContext(param(req, 'instanceId'), caller(req), baseUrl(req), req.query.review === '1')
  res.json({ success: true, data: await runPluginAppTool(bound.pluginId, req.body, bound.context, undefined, signal) })
}))
router.post('/instances/:instanceId/app/action', cancellableAsyncHandler(async (req, res, signal) => {
  const bound = pluginInstanceAppContext(param(req, 'instanceId'), caller(req), baseUrl(req), req.query.review === '1')
  res.json({ success: true, data: await runPluginServerAction({ ...req.body, pluginId: bound.pluginId }, bound.context, signal) })
}))
router.get('/instances/:instanceId/app/requests/:requestId', (req, res) => {
  const bound = pluginInstanceAppContext(param(req, 'instanceId'), caller(req), baseUrl(req))
  const request = getPluginAppRequest(param(req, 'requestId'), bound.context)
  if (request.pluginId !== bound.pluginId) { res.status(403).json({ error: '다른 확장의 요청이야.' }); return }
  res.json({ success: true, data: request })
})
router.post('/instances/:instanceId/app/requests/:requestId/cancel', (req, res) => {
  const bound = pluginInstanceAppContext(param(req, 'instanceId'), caller(req), baseUrl(req))
  const request = getPluginAppRequest(param(req, 'requestId'), bound.context)
  if (request.pluginId !== bound.pluginId) { res.status(403).json({ error: '다른 플러그인의 작업이야.' }); return }
  res.json({ success: true, data: cancelPluginAppRequest(request.id, bound.context) })
})
router.post('/instances/:instanceId/storage/:operation', (req, res) => {
  const operation = z.enum(['get', 'set', 'delete']).parse(req.params.operation)
  res.json({ success: true, data: pluginStorage(param(req, 'instanceId'), caller(req), operation, req.body) })
})
router.post('/instances/:instanceId/artifact-media', (req, res) => {
  res.json({ success: true, data: issuePluginArtifactMedia(param(req, 'instanceId'), req.body, caller(req)) })
})
/** A package with a server module carries its live state (running, failed, the tools and hooks it registered). */
const withServer = (plugin: InstalledPlugin): InstalledPlugin => plugin.manifest.server ? { ...plugin, server: pluginServerStatus(plugin.manifest.id) } : plugin
router.get('/', (req, res) => res.json({ success: true, data: listPlugins(isAdminRequest(req)).map(withServer) }))
router.post('/install', requireAdmin, multer({ storage: multer.memoryStorage(), limits: { fileSize: PLUGIN_ZIP_LIMIT, files: 1, fields: 0 } }).single('package'), asyncHandler(async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'ZIP 패키지를 선택해줘.' }); return }
  const result = await installPlugin(req.file.buffer)
  res.status(result.updated ? 200 : 201).json({ success: true, data: { ...result, plugin: withServer(result.plugin) } })
}))
router.put('/:pluginId/enabled', requireAdmin, asyncHandler(async (req, res) => {
  await setPluginEnabled(param(req, 'pluginId'), z.object({ enabled: z.boolean() }).strict().parse(req.body).enabled, getRequesterAccountId(req))
  res.json({ success: true })
}))
router.delete('/:pluginId', requireAdmin, asyncHandler(async (req, res) => { await removePlugin(param(req, 'pluginId')); res.json({ success: true }) }))
/** Trusted page SDK: short requests over durable, account-bound profile reply jobs. */
router.post('/instances/:instanceId/llm/:method', asyncHandler(async (req, res) => {
  const instance = requirePluginInstance(param(req, 'instanceId'), caller(req))
  const { callPluginLlm } = await import('../services/plugins/pluginLlm')
  res.json({ success: true, data: await callPluginLlm(instance.plugin.id, caller(req).requester, param(req, 'method'), req.body) })
}))
/** A plugin page's `api.server(body)`: its server module's onRequest, as the signed-in account. */
router.post('/instances/:instanceId/server', cancellableAsyncHandler(async (req, res, signal) => {
  const instance = requirePluginInstance(param(req, 'instanceId'), caller(req))
  if (!instance.plugin.server) { res.status(403).json({ error: '서버 모듈이 없는 플러그인이야.' }); return }
  const page = { id: instance.page.id, files: instance.fileIds, ...(instance.workspace ? { workspace: instance.workspace } : {}) }
  const bound = pluginInstanceAppContext(instance.row.id, caller(req), baseUrl(req))
  res.json({ success: true, data: await requestPluginServer(instance.plugin.id, req.body?.body ?? null, caller(req).requester, page, baseUrl(req), bound.context.workspace, signal) })
}))
const actionValueSchema = z.union([z.string().max(CHAT_PAGE_LIMITS.text), z.number(), z.boolean(), z.array(z.string().max(CHAT_PAGE_LIMITS.text)).max(32)])
const generationActionSchema = z.object({
  surface: z.enum(GENERATION_LAYOUT_SURFACES as [string, ...string[]]),
  fields: z.array(z.object({ id: z.string().max(100), label: z.string().max(160), type: z.string().max(20), value: actionValueSchema }).strip()).max(CHAT_PAGE_LIMITS.fields),
}).strict()
/** A plugin's button next to Generate: its server module answers with a note and form values, as the signed-in account. */
router.post('/:pluginId/generation-actions/:actionId', cancellableAsyncHandler(async (req, res) => {
  const input = generationActionSchema.parse(req.body)
  const plugin = getPlugin(param(req, 'pluginId'))
  const action = plugin.definition.generation?.actions.find(item => item.id === param(req, 'actionId'))
  if (!action || !(action.surfaces as string[]).includes(input.surface)) { res.status(404).json({ error: '이 화면에 없는 플러그인 버튼이야.' }); return }
  res.json({ success: true, data: await runGenerationActionHook(plugin.id, { action: action.id, surface: input.surface, fields: input.fields }, caller(req).requester) })
}))
router.post('/:pluginId/pages/:pageId/instances', (req, res) => {
  const input = z.object({ files: z.array(z.string()).max(20), workspace: z.object({ id: z.string(), write: z.boolean().default(false) }).strict().optional() }).strict().parse(req.body)
  res.status(201).json({ success: true, data: openPluginInstance(param(req, 'pluginId'), param(req, 'pageId'), input.files, caller(req), input.workspace) })
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
router.post('/instances/:instanceId/workspace/list', asyncHandler(async (req, res) => res.json({ success: true, data: await listPluginWorkspace(param(req, 'instanceId'), req.body, caller(req)) })))
router.post('/instances/:instanceId/workspace/read', cancellableAsyncHandler(async (req, res, signal) => res.json({ success: true, data: await readPluginWorkspace(param(req, 'instanceId'), req.body, caller(req), signal) })))
router.post('/instances/:instanceId/workspace/media', asyncHandler(async (req, res) => res.json({ success: true, data: await issuePluginWorkspaceMedia(param(req, 'instanceId'), req.body, caller(req)) })))
router.post('/instances/:instanceId/workspace/proposals', requirePermission('files.edit'), asyncHandler(async (req, res) => res.json({ success: true, data: await proposePluginWorkspaceWrite(param(req, 'instanceId'), req.body, caller(req)) })))
router.post('/workspace-proposals/:proposalId/approve', requirePermission('files.edit'), asyncHandler(async (req, res) => res.json({ success: true, data: await approvePluginWorkspaceWrite(param(req, 'proposalId'), caller(req)) })))
router.post('/workspace-proposals/:proposalId/apply', requirePermission('files.edit'), asyncHandler(async (req, res) => {
  const { approval } = z.object({ approval: z.string() }).strict().parse(req.body)
  res.json({ success: true, data: await applyPluginWorkspaceWrite(param(req, 'proposalId'), approval, caller(req)) })
}))
router.delete('/workspace-proposals/:proposalId', (req, res) => { dismissPluginWorkspaceWrite(param(req, 'proposalId'), caller(req)); res.json({ success: true }) })
router.post('/instances/:instanceId/workspace/stat', asyncHandler(async (req, res) => res.json({ success: true, data: await statPluginWorkspace(param(req, 'instanceId'), req.body, caller(req)) })))
router.post('/instances/:instanceId/workspace/changes', requirePermission('files.edit'), asyncHandler(async (req, res) => res.json({ success: true, data: await proposePluginWorkspaceChanges(param(req, 'instanceId'), req.body, caller(req)) })))
router.post('/instances/:instanceId/media-proposals', requirePermission('files.edit'), asyncHandler(async (req, res) => res.json({ success: true, data: await proposePluginMedia(param(req, 'instanceId'), req.body, caller(req)) })))
router.post('/media-proposals/:proposalId/approve', asyncHandler(async (req, res) => res.json({ success: true, data: await approvePluginMedia(param(req, 'proposalId'), caller(req)) })))
router.post('/media-proposals/:proposalId/apply', asyncHandler(async (req, res) => {
  const { approval } = z.object({ approval: z.string() }).strict().parse(req.body)
  res.json({ success: true, data: await applyPluginMedia(param(req, 'proposalId'), approval, caller(req)) })
}))
router.delete('/media-proposals/:proposalId', (req, res) => { dismissPluginMedia(param(req, 'proposalId'), caller(req)); res.json({ success: true }) })
router.use(pluginRouteError)
export default router
