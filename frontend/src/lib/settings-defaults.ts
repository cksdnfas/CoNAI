import { getDefaultHeaderNavigationSettings, type HeaderNavigationSettings } from '@conai/shared'

/** UI fallback used before the settings request has completed. */
export const DEFAULT_HEADER_NAVIGATION_SETTINGS: HeaderNavigationSettings = getDefaultHeaderNavigationSettings()

/** UI fallback for the artist-link template before settings are available. */
export const DEFAULT_ARTIST_LINK_URL_TEMPLATE = 'danbooru.donmai.us/posts?tags={key}'
