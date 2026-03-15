import multer from 'multer';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska'
];

const MAX_FILE_SIZE = 500 * 1024 * 1024;

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`));
  }
};

export const uploadConfig = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, runtimePaths.tempDir);
    },
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 10);
      const ext = path.extname(file.originalname);
      cb(null, `temp-upload-${timestamp}-${random}${ext}`);
    }
  }),
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter
});

export const uploadSingle = uploadConfig.fields([
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

export const uploadMultiple = uploadConfig.fields([
  { name: 'images' },
  { name: 'files' }
]);
