import fs from 'fs'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { errorResponse, successResponse } from '@conai/shared'
import { asyncHandler } from '../middleware/asyncHandler'
import { requirePermission } from '../middleware/authMiddleware'
import { getRequesterAccountId, getRequesterAccountType, isAdminRequest } from './requester-session-helpers'
import { isSpriteError } from '../services/sprite/spriteErrors'
import { readSpriteSettings } from '../services/sprite/spriteLibrary'
import type { Rect } from '../services/sprite/spritePixels'
import {
  buildFramePreview,
  buildFramesZip,
  buildSummary,
  probeLibraryVideo,
  renderBuildSheet,
  requireBuild,
  saveBuild,
  startAnimationJob,
  startExtractBatchJob,
  startExtractJob,
  startNormalizeJob,
  workspaceDownload,
  type SpriteRequester,
} from '../services/sprite/spriteService'
import type { SpriteGroupTarget } from '../services/sprite/spriteLibrary'

/**
 * /api/sprite — sprite sheets from library videos (extract, re-layout, save, frame ZIP), sheet normalisation and
 * sheet → animation. Inputs are library composite hashes; viewing needs images.view, running images.edit, and saving
 * into the library images.upload as well.
 */
const router = Router()

const VIEW = 'images.view'
const EDIT = 'images.edit'
const UPLOAD = 'images.upload'

function requester(req: Request): SpriteRequester {
  return { accountId: getRequesterAccountId(req) ?? null, accountType: isAdminRequest(req) ? 'admin' : (getRequesterAccountType(req) ?? null) }
}

/** images.upload as well, but only when the request asks to save into the library. */
function requireUploadWhenSaving(req: Request, res: Response, next: NextFunction): void {
  if (req.body?.save) {
    requirePermission(UPLOAD)(req, res, next)
    return
  }
  next()
}

function handle(run: (req: Request, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: Request, res: Response) => {
    try {
      await run(req, res)
    } catch (error) {
      if (isSpriteError(error)) {
        res.status(error.statusCode).json(errorResponse(error.message))
        return
      }
      throw error
    }
  })
}

function saveTarget(value: unknown): SpriteGroupTarget | null {
  if (!value) return null
  if (value === true) return {}
  const target = value as { groupId?: unknown; groupPath?: unknown }
  return {
    groupId: target.groupId === undefined || target.groupId === null ? undefined : Number(target.groupId),
    groupPath: typeof target.groupPath === 'string' ? target.groupPath : undefined,
  }
}

function parseCrop(value: unknown): Rect | null {
  if (!value) return null
  if (typeof value === 'object') {
    const rect = value as Record<string, unknown>
    return { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) }
  }
  const parts = String(value).split(',').map(Number)
  return parts.length === 4 ? { x: parts[0], y: parts[1], width: parts[2], height: parts[3] } : null
}

function numberQuery(value: unknown): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function renderFrom(source: Record<string, unknown>) {
  return {
    columns: numberQuery(source.columns),
    spacing: numberQuery(source.spacing),
    crop: parseCrop(source.crop),
    format: source.format === 'webp' ? 'webp' as const : source.format === 'png' ? 'png' as const : undefined,
    quality: numberQuery(source.quality),
  }
}

function sendFile(res: Response, file: string, fileName: string, mimeType: string, inline = false) {
  res.setHeader('Content-Type', mimeType)
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  res.setHeader('Cache-Control', 'no-store')
  fs.createReadStream(file).pipe(res)
}

router.get('/videos/:hash/info', requirePermission(VIEW), handle(async (req, res) => {
  res.json(successResponse(await probeLibraryVideo(String(req.params.hash))))
}))

router.post('/extract', requirePermission(EDIT), requireUploadWhenSaving, handle(async (req, res) => {
  const body = req.body ?? {}
  const job = startExtractJob({
    videoHash: String(body.videoHash ?? ''),
    options: body.options ?? {},
    frameIndices: Array.isArray(body.frameIndices) ? body.frameIndices.map(Number) : undefined,
    render: body.render ? renderFrom(body.render) : undefined,
    save: saveTarget(body.save),
    requester: requester(req),
  })
  res.status(202).json(successResponse(job))
}))

router.post('/extract-batch', requirePermission(EDIT), requirePermission(UPLOAD), handle(async (req, res) => {
  const body = req.body ?? {}
  const job = startExtractBatchJob({
    videoHashes: Array.isArray(body.videoHashes) ? body.videoHashes.map(String) : [],
    options: body.options ?? {},
    render: body.render ? renderFrom(body.render) : undefined,
    save: saveTarget(body.save ?? true) ?? {},
    requester: requester(req),
  })
  res.status(202).json(successResponse(job))
}))

router.get('/builds/:buildId', requirePermission(VIEW), handle(async (req, res) => {
  res.json(successResponse(buildSummary(requireBuild(String(req.params.buildId), requester(req)).meta)))
}))

router.get('/builds/:buildId/frames/:index', requirePermission(VIEW), handle(async (req, res) => {
  const png = await buildFramePreview(String(req.params.buildId), Number(req.params.index), numberQuery(req.query.size) ?? 256, requester(req))
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'private, max-age=300')
  res.end(png)
}))

router.get('/builds/:buildId/sheet', requirePermission(VIEW), handle(async (req, res) => {
  const rendered = await renderBuildSheet(String(req.params.buildId), renderFrom(req.query as Record<string, unknown>), requester(req))
  res.setHeader('X-Sheet-Width', String(rendered.width))
  res.setHeader('X-Sheet-Height', String(rendered.height))
  res.setHeader('X-Sheet-Columns', String(rendered.layout.columns))
  res.setHeader('X-Sheet-Rows', String(rendered.layout.rows))
  res.on('close', () => fs.rmSync(rendered.file, { force: true }))
  sendFile(res, rendered.file, `sprite-sheet.${rendered.format}`, rendered.mimeType, req.query.download !== '1')
}))

router.post('/builds/:buildId/save', requirePermission(EDIT), requirePermission(UPLOAD), handle(async (req, res) => {
  const body = req.body ?? {}
  const saved = await saveBuild(String(req.params.buildId), renderFrom(body.render ?? {}), saveTarget(body.group ?? true) ?? undefined, requester(req))
  res.json(successResponse(saved))
}))

router.get('/builds/:buildId/frames.zip', requirePermission(VIEW), handle(async (req, res) => {
  const zip = await buildFramesZip(String(req.params.buildId), {
    crop: parseCrop(req.query.crop),
    format: req.query.format === 'webp' ? 'webp' : 'png',
    quality: numberQuery(req.query.quality),
    stem: typeof req.query.stem === 'string' ? req.query.stem : undefined,
  }, requester(req))
  res.on('close', () => fs.rmSync(zip.file, { force: true }))
  sendFile(res, zip.file, zip.fileName, 'application/zip')
}))

router.post('/normalize', requirePermission(EDIT), requireUploadWhenSaving, handle(async (req, res) => {
  const body = req.body ?? {}
  const job = startNormalizeJob({ sheets: Array.isArray(body.sheets) ? body.sheets : [], options: body.options ?? {}, save: saveTarget(body.save), requester: requester(req) })
  res.status(202).json(successResponse(job))
}))

router.post('/animation', requirePermission(EDIT), requireUploadWhenSaving, handle(async (req, res) => {
  const body = req.body ?? {}
  const job = startAnimationJob({ sheetHash: String(body.sheetHash ?? ''), options: body.options ?? {}, save: saveTarget(body.save), requester: requester(req) })
  res.status(202).json(successResponse(job))
}))

router.get('/results/:workspaceId/download', requirePermission(VIEW), handle(async (req, res) => {
  const download = workspaceDownload(String(req.params.workspaceId), requester(req), typeof req.query.file === 'string' ? req.query.file : undefined)
  const mimeType = download.fileName.endsWith('.zip') ? 'application/zip' : download.fileName.endsWith('.gif') ? 'image/gif' : download.fileName.endsWith('.mp4') ? 'video/mp4' : 'image/webp'
  sendFile(res, download.file, download.fileName, mimeType)
}))

router.get('/settings/:hash', requirePermission(VIEW), handle(async (req, res) => {
  res.json(successResponse(await readSpriteSettings(String(req.params.hash))))
}))

export default router
