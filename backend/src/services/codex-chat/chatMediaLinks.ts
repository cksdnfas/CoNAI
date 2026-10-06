import sharp from 'sharp'

/**
 * Library media written into chat text: `media:<composite hash>.<ext>`. The extension only tells the chat whether to
 * draw an image or a video; the hash is the library's pixel identity, so the link survives file moves and rescans.
 */
export const MEDIA_SCHEME = 'media:'
export const MEDIA_LINK_PATTERN = /media:([a-f0-9]{48}|[a-f0-9]{32})\.([a-z0-9]{2,5})\b/g
export const MEDIA_HASH_PATTERN = /^(?:[a-f0-9]{48}|[a-f0-9]{32})$/
export const MEDIA_MAX_PIXELS = 40_000_000

export const MEDIA_MIME_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
}
const SHARP_EXTENSIONS: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif' }

/** Markdown images (alt text may hold one level of [brackets]), HTML <img>/<source>, and whole <video> elements pointing at the web. */
const MARKDOWN_IMAGE = /!\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/g
const HTML_VIDEO = /<video\b([^>]*)>([\s\S]*?)<\/video\s*>/gi
const HTML_MEDIA = /<(?:img|video|source)\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi
const SRC_ATTRIBUTE = /\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/i
const ALT_ATTRIBUTE = /\b(?:alt|title)\s*=\s*["']([^"']*)["']/i

export function mediaLink(compositeHash: string, extension: string) {
  return `${MEDIA_SCHEME}${compositeHash}.${extension}`
}

function videoSource(attributes: string, body: string) {
  return SRC_ATTRIBUTE.exec(attributes)?.[1] ?? SRC_ATTRIBUTE.exec(body)?.[1] ?? null
}

const altOf = (value: string | undefined) => (value ?? '').replace(/[[\]\n]/g, ' ').trim()

/** Every web image or video these texts show, in order of first appearance. */
export function findMediaUrls(texts: string[]) {
  const found: Array<{ index: number; url: string }> = []
  for (const [textIndex, text] of texts.entries()) {
    const at = (offset: number) => textIndex * 1e7 + offset
    for (const match of text.matchAll(MARKDOWN_IMAGE)) found.push({ index: at(match.index ?? 0), url: match[2] })
    for (const match of text.matchAll(HTML_VIDEO)) {
      const url = videoSource(match[1], match[2])
      if (url) found.push({ index: at(match.index ?? 0), url })
    }
    for (const match of text.matchAll(HTML_MEDIA)) found.push({ index: at(match.index ?? 0), url: match[1] })
  }
  return [...new Set(found.sort((a, b) => a.index - b.index).map((entry) => entry.url))]
}

/**
 * Point saved links at their library copies. HTML tags become Markdown images: chat does not render raw HTML, and a
 * <video> element is replaced whole so its leftover tags cannot swallow the image into an HTML block.
 */
export function rewriteMediaLinks(text: string, saved: Map<string, string>) {
  if (saved.size === 0 || !text) return text
  return text
    .replace(MARKDOWN_IMAGE, (whole, alt: string, url: string) => saved.has(url) ? `![${alt}](${saved.get(url)})` : whole)
    .replace(HTML_VIDEO, (whole, attributes: string, body: string) => {
      const url = videoSource(attributes, body)
      return url && saved.has(url) ? `![${altOf(ALT_ATTRIBUTE.exec(attributes)?.[1])}](${saved.get(url)})` : whole
    })
    .replace(HTML_MEDIA, (whole, url: string) => saved.has(url) ? `![${altOf(ALT_ATTRIBUTE.exec(whole)?.[1])}](${saved.get(url)})` : whole)
}

/** The library media these texts link to. */
export function findMediaLinks(texts: string[]) {
  const links = new Map<string, { compositeHash: string; extension: string }>()
  for (const text of texts) {
    for (const match of text.matchAll(MEDIA_LINK_PATTERN)) links.set(match[1], { compositeHash: match[1], extension: match[2] })
  }
  return [...links.values()]
}

/** What a downloaded file really is: png/jpg/webp/gif by decoding, mp4/mov/webm by their container signature. */
export async function sniffMediaExtension(buffer: Buffer): Promise<string> {
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    return buffer.subarray(8, 12).toString('latin1') === 'qt  ' ? 'mov' : 'mp4'
  }
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0x1a45dfa3) {
    if (buffer.subarray(0, 64).includes(Buffer.from('webm'))) return 'webm'
    throw new Error('not an image')
  }
  let format: string | undefined
  try {
    format = (await sharp(buffer, { limitInputPixels: MEDIA_MAX_PIXELS, animated: true }).metadata()).format
  } catch {
    throw new Error('not an image')
  }
  const extension = format ? SHARP_EXTENSIONS[format] : undefined
  if (!extension) throw new Error('not an image')
  return extension
}
