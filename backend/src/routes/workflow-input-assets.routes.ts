import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { runtimePaths } from '../config/runtimePaths';
import { asyncHandler } from '../middleware/asyncHandler';
import { streamRangeFile } from './images/query-file-response-helpers';
import {
  markWorkflowInputAssetForDeletion,
  pruneDeletedWorkflowInputAssets,
  resolveWorkflowInputAssetPath,
  storeWorkflowInputAssetFile,
} from '../services/workflowInputAssetStore';

const router = Router();
const MAX_WORKFLOW_INPUT_ASSET_BYTES = 500 * 1024 * 1024;
const ALLOWED_MEDIA_MIME_PREFIXES = ['image/', 'video/', 'audio/'] as const;
const ALLOWED_MEDIA_EXTENSIONS = new Set([
  '.aac', '.aif', '.aiff', '.alac', '.amr', '.ape', '.avi', '.avif', '.bmp', '.caf', '.flac', '.gif',
  '.3gp', '.flv', '.heic', '.heif', '.jpeg', '.jpg', '.jxl', '.m2ts', '.m4a', '.m4v', '.mka', '.mkv',
  '.mov', '.mp3', '.mp4', '.mpeg', '.mpg', '.mts', '.oga', '.ogg', '.opus', '.png', '.tif', '.tiff',
  '.ts', '.wav', '.weba', '.webm', '.webp', '.wma', '.wmv',
]);

const uploadWorkflowInputAsset = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(runtimePaths.tempDir, { recursive: true });
      callback(null, runtimePaths.tempDir);
    },
    filename: (_req, file, callback) => {
      callback(null, `workflow-input-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);
    },
  }),
  limits: {
    fileSize: MAX_WORKFLOW_INPUT_ASSET_BYTES,
    files: 1,
    fields: 4,
    parts: 5,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeAllowed = ALLOWED_MEDIA_MIME_PREFIXES.some((prefix) => file.mimetype.startsWith(prefix));
    const extensionAllowed = ALLOWED_MEDIA_EXTENSIONS.has(extension);
    if (extensionAllowed || (!extension && mimeAllowed)) {
      callback(null, true);
      return;
    }

    callback(new Error('Only image, video, and audio files are supported'));
  },
}).single('file');

/** Convert multipart parser errors into bounded API responses. */
function parseWorkflowInputAsset(req: Request, res: Response, next: (error?: unknown) => void) {
  uploadWorkflowInputAsset(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ success: false, error: error instanceof Error ? error.message : 'Workflow input upload failed' });
  });
}

router.post('/', parseWorkflowInputAsset, asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'A media file is required' });
  }

  try {
    pruneDeletedWorkflowInputAssets();
    const ref = storeWorkflowInputAssetFile(req.file.path, {
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      bytes: req.file.size,
    });
    return res.status(201).json({ success: true, data: ref });
  } catch (error) {
    fs.rmSync(req.file.path, { force: true });
    throw error;
  }
}));

router.get('/:assetId', (req: Request, res: Response) => {
  const assetId = String(req.params.assetId || '');
  const absolutePath = resolveWorkflowInputAssetPath(assetId);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return res.status(404).json({ success: false, error: 'Workflow input asset not found' });
  }

  const mimeType = typeof req.query.mime === 'string' && /^(image|video|audio)\/[a-zA-Z0-9.+-]+$/.test(req.query.mime)
    ? req.query.mime
    : 'application/octet-stream';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return streamRangeFile(req, res, absolutePath, mimeType);
});

router.delete('/:assetId', (req: Request, res: Response) => {
  const removed = markWorkflowInputAssetForDeletion(String(req.params.assetId || ''));
  return res.json({ success: true, data: { removed } });
});

export { router as workflowInputAssetRoutes };
