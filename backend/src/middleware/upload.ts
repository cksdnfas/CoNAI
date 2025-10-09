import multer from 'multer';
import { Request } from 'express';

// 지원되는 이미지 MIME 타입
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/gif'
];

// 최대 파일 크기 (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// 파일 필터 함수
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`));
  }
};

// Multer 설정 (메모리 저장)
export const uploadConfig = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 50 // 최대 50개 파일 동시 업로드
  },
  fileFilter
});

// 단일 파일 업로드 미들웨어 (image 또는 file 필드명 모두 허용)
export const uploadSingle = uploadConfig.fields([
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

// 다중 파일 업로드 미들웨어 (images 또는 files 필드명 모두 허용)
export const uploadMultiple = uploadConfig.fields([
  { name: 'images', maxCount: 50 },
  { name: 'files', maxCount: 50 }
]);