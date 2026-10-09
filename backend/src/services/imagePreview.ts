import sharp from 'sharp'
import { MEDIA_MAX_PIXELS } from './codex-chat/chatMediaLinks'

/** The same 512px JPEG sent by view_images and explicit asset vision reviews (images the user attached go larger). */
export async function previewImage(filePath: string, size = 512) {
  const buffer = await sharp(filePath, { animated: false, limitInputPixels: MEDIA_MAX_PIXELS })
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .toBuffer()
  return buffer.toString('base64')
}
