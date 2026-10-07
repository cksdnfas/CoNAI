import sharp from 'sharp'
import { MEDIA_MAX_PIXELS } from './codex-chat/chatMediaLinks'

/** The same 512px JPEG sent by view_images and explicit asset vision reviews. */
export async function previewImage(filePath: string) {
  const buffer = await sharp(filePath, { animated: false, limitInputPixels: MEDIA_MAX_PIXELS })
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .toBuffer()
  return buffer.toString('base64')
}
