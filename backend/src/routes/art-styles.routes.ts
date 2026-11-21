import fs from 'fs'
import express, { type Request, type Response } from 'express'
import multer from 'multer'
import { ZipArchive } from 'archiver'
import { z } from 'zod'
import { createUploadStorage, MAX_MULTIPLE_UPLOAD_TOTAL_BYTES } from '../middleware/upload'
import { asyncHandler } from '../middleware/asyncHandler'
import { requirePermission } from '../middleware/authMiddleware'
import { canRequesterViewImages, requireImagesView } from '../middleware/imageAccess'
import { getRequester } from './requester-session-helpers'
import { routeParam } from './routeParam'
import { streamCacheableFile } from './images/query-file-response-helpers'
import { CharacterLibraryError } from '../services/characterLibraryError'
import { fileOwnerKey, FileStoreError } from '../services/fileStoreService'
import { getFileThumbnail } from '../services/fileStorePreview'
import * as styles from '../services/artStyles'

/**
 * `/api/art-styles`: art styles (그림 스타일). Read with characters.view, write with characters.edit; images need
 * images.view. A style's images are its own file-store copies, served here (`/:styleId/files/:fileId`), never through
 * /api/files.
 */
const router = express.Router()
const view = requirePermission('characters.view')
const edit = requirePermission('characters.edit')
const styleId = (req: Request) => styles.artStyleId(req.params.styleId)
const images = (req: Request) => canRequesterViewImages(getRequester(req))
const actor = (req: Request): styles.ArtStyleActor => {
  const requester = getRequester(req)
  return { owner: fileOwnerKey(requester.accountId), canViewImages: canRequesterViewImages(requester), requester }
}
function failure(res: Response, error: unknown, fallback: string) {
  if (error instanceof FileStoreError) { res.status(error.status).json({ success: false, error: error.message }); return }
  res.status(error instanceof CharacterLibraryError ? error.status : 400).json({
    success: false, error: error instanceof Error ? error.message : fallback,
    ...(error instanceof CharacterLibraryError && error.revision !== undefined ? { revision: error.revision } : {}),
    ...(error instanceof CharacterLibraryError && error.code ? { code: error.code } : {}),
  })
}
function handle(run: (req: Request, res: Response) => unknown | Promise<unknown>, status = 200) {
  return asyncHandler(async (req, res) => {
    try { res.status(status).json({ success: true, data: await run(req, res) }) }
    catch (error) { failure(res, error, '그림 스타일 작업을 처리하지 못했어.') }
  })
}
/** The list scope from the query string; `badges` is a JSON array of badge names. */
const listScope = (req: Request) => ({
  ...(req.query.query !== undefined ? { query: z.string().parse(req.query.query) } : {}),
  ...(req.query.favorite === '1' ? { favorite: true } : {}),
})
router.get('/', view, handle((req) => styles.listArtStyles({
  ...listScope(req),
  ...(req.query.badges !== undefined ? { badges: JSON.parse(z.string().parse(req.query.badges)) } : {}),
  ...(req.query.sort !== undefined ? { sort: req.query.sort } : {}),
  ...(req.query.limit !== undefined ? { limit: Number(req.query.limit) } : {}),
  ...(req.query.offset !== undefined ? { offset: Number(req.query.offset) } : {}),
}, images(req))))
router.get('/badges', view, handle((req) => styles.artStyleBadges(listScope(req))))
router.post('/bulk', edit, handle((req) => styles.bulkArtStyles(req.body, actor(req))))
/** A ZIP of the document and its images; images are already compressed, so entries are stored. */
router.post('/export', view, asyncHandler(async (req, res) => {
  let bundle: ReturnType<typeof styles.exportArtStyles>
  try { bundle = styles.exportArtStyles(req.body, images(req)) }
  catch (error) { failure(res, error, '내보내지 못했어.'); return }
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="art-styles.zip"')
  res.setHeader('X-Art-Style-Count', String(bundle.document.styles.length))
  res.setHeader('Cache-Control', 'private, no-store')
  await new Promise<void>((resolve, reject) => {
    const archive = new ZipArchive({ store: true })
    archive.once('error', reject)
    res.once('error', reject)
    res.once('close', () => { if (!res.writableFinished) { archive.abort(); resolve() } })
    res.once('finish', resolve)
    archive.pipe(res)
    archive.append(Buffer.from(JSON.stringify(bundle.document, null, 2)), { name: styles.ART_STYLE_BUNDLE_DOCUMENT })
    for (const file of bundle.files) archive.file(file.path, { name: file.name })
    void archive.finalize()
  })
}))
const bundleUpload = multer({ storage: createUploadStorage(MAX_MULTIPLE_UPLOAD_TOTAL_BYTES), limits: { files: 1, fields: 1, parts: 2 } }).single('file')
router.post('/import', edit, (req, res, next) => {
  bundleUpload(req, res, (error) => {
    if (error) { res.status(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, error: '그림 스타일 묶음 ZIP 하나를 골라줘.' }); return }
    next()
  })
}, handle(async (req) => {
  try {
    if (!req.file) throw new styles.ArtStyleError('그림 스타일 묶음 ZIP을 골라줘.')
    return await styles.importArtStyles({ bundlePath: req.file.path }, actor(req))
  } finally { if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {}) }
}, 201))
router.get('/:styleId', view, handle((req) => styles.getArtStyle(styleId(req), images(req))))
router.post('/', edit, handle((req) => styles.createArtStyle(req.body, actor(req)), 201))
router.patch('/:styleId', edit, handle((req) => styles.patchArtStyle(styleId(req), req.body, actor(req))))
router.delete('/:styleId', edit, handle((req) => styles.deleteArtStyle(styleId(req), req.query.revision === undefined ? undefined : styles.artStyleId(req.query.revision), actor(req))))

/** A file the style holds (404 for any other file or one deleted from the store). */
function styleFile(req: Request, res: Response) {
  const id = Number(routeParam(req.params.styleId))
  const fileId = routeParam(req.params.fileId)
  if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-f0-9]{32}$/.test(fileId)) {
    res.status(400).json({ success: false, error: 'Invalid style or file ID' })
    return null
  }
  const file = styles.resolveArtStyleFile(id, fileId)
  if (!file) res.status(404).json({ success: false, error: 'Art style image not found' })
  return file
}
router.get('/:styleId/files/:fileId', view, requireImagesView, asyncHandler(async (req, res) => {
  const file = styleFile(req, res)
  if (!file) return
  res.setHeader('Content-Security-Policy', 'sandbox')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  try { await streamCacheableFile(req, res, file.filePath, file.mimeType) }
  catch (error) {
    console.error('[Art style media] Failed to serve image', error)
    if (!res.headersSent) res.status((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500).json({ success: false, error: 'Art style image is unavailable' })
  }
}))
router.get('/:styleId/files/:fileId/thumbnail', view, requireImagesView, asyncHandler(async (req, res) => {
  const file = styleFile(req, res)
  if (!file) return
  let cached: string
  try { cached = await getFileThumbnail('bootstrap', file.entry, file.filePath) }
  catch (error) { failure(res, error, '썸네일을 만들지 못했어.'); return }
  res.setHeader('Content-Type', 'image/webp')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-cache')
  res.sendFile(cached, { dotfiles: 'allow' })
}))
export default router
