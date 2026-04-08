import { DEFAULT_ARTIST_LINK_URL_TEMPLATE } from '@/types/settings'

export function normalizeArtistLinkUrlTemplate(template: string | null | undefined) {
  const normalized = template?.trim()
  return normalized && normalized.length > 0 ? normalized : DEFAULT_ARTIST_LINK_URL_TEMPLATE
}

export function buildArtistPromptTagUrl(tag: string, template: string | null | undefined) {
  const normalizedTemplate = normalizeArtistLinkUrlTemplate(template)
  const replaced = normalizedTemplate.replaceAll('{key}', encodeURIComponent(tag.trim()))

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(replaced)) {
    return replaced
  }

  return `https://${replaced.replace(/^\/+/, '')}`
}
