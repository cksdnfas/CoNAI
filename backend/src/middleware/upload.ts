import multer from 'multer';
import { Request } from 'express';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';

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
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`));
  }
};

// Multer 설정 (디스크 저장 - 메모리 부담 제거)
export const uploadConfig = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      // 임시 폴더에 저장 (runtimePaths.tempDir)
      cb(null, runtimePaths.tempDir);
    },
    filename: (_req, file, cb) => {
      // 고유한 임시 파일명 생성: temp-upload-타임스탬프-랜덤문자열.확장자
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 10);
      const ext = path.extname(file.originalname);
      cb(null, `temp-upload-${timestamp}-${random}${ext}`);
    }
  }),
  limits: {
    fileSize: MAX_FILE_SIZE
    // files 제한 제거 - diskStorage 사용으로 메모리 문제 해결
  },
  fileFilter
});

// 단일 파일 업로드 미들웨어 (image 또는 file 필드명 모두 허용)
export const uploadSingle = uploadConfig.fields([
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

// 다중 파일 업로드 미들웨어 (images 또는 files 필드명 모두 허용)
// 파일 개수 제한 제거 - diskStorage 사용으로 메모리 걱정 없음
export const uploadMultiple = uploadConfig.fields([
  { name: 'images' },
  { name: 'files' }
]);