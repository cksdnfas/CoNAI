import {
  HEADER_NAVIGATION_ITEM_KEYS,
  type HeaderNavigationSettings,
} from '@conai/shared'

/** UI fallback used before the settings request has completed. */
export const DEFAULT_HEADER_NAVIGATION_SETTINGS: HeaderNavigationSettings = HEADER_NAVIGATION_ITEM_KEYS.reduce(
  (settings, key) => {
    settings[key] = true
    return settings
  },
  {} as HeaderNavigationSettings,
)

/** UI fallback for the artist-link template before settings are available. */
export const DEFAULT_ARTIST_LINK_URL_TEMPLATE = 'danbooru.donmai.us/posts?tags={key}'
