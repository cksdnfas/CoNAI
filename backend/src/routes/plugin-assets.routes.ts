import { Router } from 'express'
import { getPlugin, packageFile, PluginError } from '../services/plugins/pluginRegistry'
import { resolvePluginMedia } from '../services/plugins/pluginHost'
import { filePreviewMime } from '../services/fileStorePreview'
import { AuthAccessControlService } from '../services/authAccessControlService'
import { pluginRouteError } from './plugins.routes'

/** These terminal routers precede the credentialed global CORS policy. No request falls through to that policy. */
export const pluginAssetRoutes = Router()
export const pluginMediaRoutes = Router()
for (const router of [pluginAssetRoutes, pluginMediaRoutes]) {
  router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.removeHeader('Access-Control-Allow-Credentials')
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Range')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, no-store')
    if (req.method === 'OPTIONS') { res.status(204).end(); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).end(); return }
    next()
  })
}
pluginAssetRoutes.get('/:pluginId/:version/*asset', (req, res, next) => {
  try {
    const id = String(req.params.pluginId), version = String(req.params.version)
    const plugin = getPlugin(id)
    if (plugin.version !== version) throw new PluginError('패키지 버전이 바뀌었어.', 404)
    const asset = Array.isArray(req.params.asset) ? req.params.asset.join('/') : String(req.params.asset)
    const file = packageFile(id, version, asset)
    const host = req.get('host') ?? ''
    if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host)) throw new PluginError('잘못된 호스트야.')
    const origin = `${req.protocol}://${host}`
    const base = `${origin}/api/plugin-assets/${id}/${version}/`
    res.setHeader('Content-Security-Policy', `sandbox allow-scripts; default-src 'none'; script-src ${base}; style-src ${base}; font-src ${base}; img-src ${base} ${origin}/api/plugin-media/ blob:; media-src ${origin}/api/plugin-media/ blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'self'`)
    // The verified private root itself may be a dot-directory (portable/dev instances).
    res.sendFile(file, { dotfiles: 'allow' }, (error) => { if (error) next(error) })
  } catch (error) { next(error) }
})
pluginMediaRoutes.get('/:token', async (req, res, next) => {
  try {
    const { entry, filePath, requester } = resolvePluginMedia(String(req.params.token))
    const mime = await filePreviewMime(entry, filePath)
    if (!mime || !/^(image|video|audio)\//.test(mime)) throw new PluginError('표시할 수 없는 미디어야.', 415)
    if (/^(image|video)\//.test(mime) && requester.accountId !== null && !AuthAccessControlService.hasPermission(requester.accountId, 'images.view')) throw new PluginError('미디어 접근 권한이 없어.', 403)
    // The async MIME probe must not let revocation or file replacement race the final send.
    resolvePluginMedia(String(req.params.token))
    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.sendFile(filePath, { dotfiles: 'allow' }, (error) => { if (error) next(error) })
  } catch (error) { next(error) }
})
for (const router of [pluginAssetRoutes, pluginMediaRoutes]) {
  router.use(pluginRouteError)
  router.use((_req, res) => { res.status(404).end() })
}
