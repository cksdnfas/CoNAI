import { LibraryIngestError } from './libraryMediaIngest';
import { ALLOWED_MIME_TYPES } from '../middleware/upload';

const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/tiff': 'tiff',
  'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi',
};

/** MCP requestSecurity checks the decoded size, base64 and media family before this format lookup. */
export function parseLibraryMediaDataUrl(dataUrl: string): { bytes: Buffer; extension: string; mimeType: string } {
  const match = /^data:((?:image|video)\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) throw new LibraryIngestError('Expected a base64 image/* or video/* data URL.', 400);
  const mimeType = match[1].toLowerCase();
  const extension = MEDIA_EXTENSIONS[mimeType];
  if (!ALLOWED_MIME_TYPES.includes(mimeType) || !extension) {
    throw new LibraryIngestError(`Unsupported library media MIME type: ${mimeType}`, 400);
  }
  return { bytes: Buffer.from(match[2], 'base64'), extension, mimeType };
}
