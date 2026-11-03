import fs from 'fs'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { asyncHandler } from '../middleware/asyncHandler'
import { createUploadStorage, wrapUploadMiddleware, MAX_UPLOAD_FILE_SIZE_BYTES, MAX_MULTIPLE_UPLOAD_FILES, MAX_MULTIPLE_UPLOAD_TOTAL_BYTES } from '../middleware/upload'
import { FileStoreError, FileStoreService, assertFileTypeAllowed, chatAttachmentOwner, parseFileId } from '../services/fileStoreService'
import { ensureFileStoreDirectories, fileStoreIncoming } from '../services/fileStorePaths'
import { getRequesterAccountId, isAdminRequest } from './requester-session-helpers'
import { parseId, requireChatAccess } from './codex-chat-route-helpers'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import { requirePrivateAttachmentDestination } from '../services/codex-chat/chatAttachmentPrivacy'

const router = Router()
router.use(requireChatAccess)
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next() })
const owner = (req: Request) => chatAttachmentOwner(getRequesterAccountId(req))
function requireUploadThread(req: Request) {
  const threadId = parseId(req.query.threadId)
  if (threadId === null) throw new FileStoreError('파일을 첨부할 채팅을 선택해줘.')
  if (!CodexChatStore.findThread(threadId, getRequesterAccountId(req))) throw new FileStoreError('채팅을 찾을 수 없어.', 404)
  requirePrivateAttachmentDestination(threadId)
}
const upload = wrapUploadMiddleware(multer({
  storage: createUploadStorage(MAX_MULTIPLE_UPLOAD_TOTAL_BYTES, fileStoreIncoming, false),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES, files: MAX_MULTIPLE_UPLOAD_FILES, fields: 0, parts: MAX_MULTIPLE_UPLOAD_FILES },
  fileFilter: (req, file, callback) => {
    try { assertFileTypeAllowed(file.originalname, req.res?.locals.allowAnyType === true); callback(null, true) }
    catch (error) { callback(error as Error) }
  },
}).array('files', MAX_MULTIPLE_UPLOAD_FILES))

router.post('/upload', (req, res, next) => {
  requireUploadThread(req)
  ensureFileStoreDirectories()
  res.locals.allowAnyType = isAdminRequest(req)
  next()
}, upload, asyncHandler(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : []
  try {
    if (!files.length) throw new FileStoreError('파일을 선택해줘.')
    requireUploadThread(req)
    const data = FileStoreService.upload(owner(req), null, files, res.locals.allowAnyType === true)
    FileStoreService.purgeDeleted()
    res.status(201).json({ success: true, data })
  } finally {
    await Promise.all(files.map(file => fs.promises.rm(file.path, { force: true })))
  }
}))

router.get('/:id/download', (req, res, next) => {
  const { entry, filePath } = FileStoreService.resolveFile(owner(req), parseFileId(req.params.id) as string)
  if (!entry.chatAttachment) throw new FileStoreError('채팅 첨부를 찾을 수 없어.', 404)
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', 'sandbox')
  res.download(filePath, entry.name, { dotfiles: 'allow' }, error => { if (error && !res.headersSent) next(error) })
})

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof FileStoreError) { res.status(error.status).json({ success: false, error: error.message }); return }
  next(error)
})
export default router
