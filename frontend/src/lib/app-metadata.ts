declare const __APP_VERSION__: string | undefined

const appBaseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`

export const APP_NAME = 'CoNAI'
export const APP_VERSION = typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim().length > 0 ? __APP_VERSION__ : '0.0.0'
export const APP_VERSION_LABEL = `v${APP_VERSION}`
export const APP_BRAND_TOOLTIP = `${APP_NAME} ${APP_VERSION_LABEL}`
export const APP_ICON_SRC = `${appBaseUrl}android-chrome-192x192.png`
