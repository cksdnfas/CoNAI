import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { Transform, pipeline } from 'stream';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
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

export const MAX_UPLOAD_FILE_SIZE_BYTES = 500 * 1024 * 1024;
export const MAX_MULTIPLE_UPLOAD_FILES = 20;
export const MAX_MULTIPLE_UPLOAD_TOTAL_BYTES = 1024 * 1024 * 1024;

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`));
  }
};

const REQUEST_UPLOAD_BYTES = Symbol('requestUploadBytes');

type UploadRequestWithByteCount = Request & {
  [REQUEST_UPLOAD_BYTES]?: number;
};

/** Stream one multipart file to disk while enforcing a request-wide byte budget. */
function createUploadStorage(maxRequestBytes: number): multer.StorageEngine {
  return {
    _handleFile(req, file, cb) {
      const uploadRequest = req as UploadRequestWithByteCount;
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 10);
      const ext = path.extname(file.originalname);
      const filename = `temp-upload-${timestamp}-${random}${ext}`;
      const filePath = path.join(runtimePaths.tempDir, filename);
      const output = fs.createWriteStream(filePath, { flags: 'wx' });

      const quota = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          const nextTotal = (uploadRequest[REQUEST_UPLOAD_BYTES] ?? 0) + chunk.length;
          uploadRequest[REQUEST_UPLOAD_BYTES] = nextTotal;
          if (nextTotal > maxRequestBytes) {
            const error = new multer.MulterError('LIMIT_FILE_SIZE', file.fieldname);
            error.message = `Combined upload exceeds ${maxRequestBytes} bytes`;
            callback(error);
            return;
          }

          callback(null, chunk);
        },
      });

      pipeline(file.stream, quota, output, (error) => {
        if (error) {
          fs.unlink(filePath, () => cb(error));
          return;
        }

        cb(null, {
          destination: runtimePaths.tempDir,
          filename,
          path: filePath,
          size: output.bytesWritten,
        });
      });
    },
    _removeFile(_req, file, cb) {
      const filePath = file.path;

      if (!filePath) {
        cb(null);
        return;
      }

      fs.unlink(filePath, (error) => cb(error?.code === 'ENOENT' ? null : error));
    },
  };
}

const uploadSingleConfig = multer({
  storage: createUploadStorage(MAX_UPLOAD_FILE_SIZE_BYTES),
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
    files: 1,
    fields: 20,
    parts: 21,
  },
  fileFilter,
});

const uploadMultipleConfig = multer({
  storage: createUploadStorage(MAX_MULTIPLE_UPLOAD_TOTAL_BYTES),
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
    files: MAX_MULTIPLE_UPLOAD_FILES,
    fields: 20,
    parts: MAX_MULTIPLE_UPLOAD_FILES + 20,
  },
  fileFilter,
});

/** Convert Multer parser failures into bounded client errors instead of generic 500s. */
function wrapUploadMiddleware(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }

      const message = error instanceof Error ? error.message : 'Upload parsing failed';
      const statusCode = error instanceof multer.MulterError
        ? (error.code === 'LIMIT_UNEXPECTED_FILE' ? 400 : 413)
        : message.startsWith('Unsupported file type:') ? 415 : 400;

      res.status(statusCode).json({
        success: false,
        error: message,
      });
    });
  };
}

const parseSingleUpload = uploadSingleConfig.fields([
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

const parseMultipleUpload = uploadMultipleConfig.fields([
  { name: 'images', maxCount: MAX_MULTIPLE_UPLOAD_FILES },
  { name: 'files', maxCount: MAX_MULTIPLE_UPLOAD_FILES }
]);

export const uploadSingle = wrapUploadMiddleware(parseSingleUpload);
export const uploadMultiple = wrapUploadMiddleware(parseMultipleUpload);
