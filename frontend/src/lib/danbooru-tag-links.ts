const DANBOORU_POSTS_URL = 'https://danbooru.donmai.us/posts?tags='

export function normalizeDanbooruTagQuery(tag: string) {
  return tag.trim().replace(/\s+/g, '_')
}

export function buildDanbooruTagUrl(tag: string) {
  const normalizedTag = normalizeDanbooruTagQuery(tag)
  return normalizedTag ? `${DANBOORU_POSTS_URL}${encodeURIComponent(normalizedTag)}` : null
}
