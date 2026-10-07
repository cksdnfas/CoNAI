import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRuntimeLanguageSettings } from '@/lib/api-settings'
import type { GeneralSettings } from '@conai/shared'
import { authCatalog } from './resources/auth'
import { shellCatalog } from './resources/shell'

export type AppLanguage = GeneralSettings['language']
export type TranslationDictionary = Partial<Record<AppLanguage, string>>
export type TranslationInput = string | TranslationDictionary
export type TranslationParams = Record<string, string | number | boolean | null | undefined>
export type TranslationCatalog = Record<string, TranslationDictionary>

const DEFAULT_LANGUAGE: AppLanguage = 'ko'
/** Effective UI language; also read by `api-error-fallbacks` outside React. */
const LANGUAGE_STORAGE_KEY = 'conai.language'
/** Last server-wide default seen, so "use default" still works for accounts that cannot read `/api/settings`. */
const DEFAULT_LANGUAGE_STORAGE_KEY = 'conai.language.default'
/** Per-browser choice from the account menu; wins over the server default. */
const LANGUAGE_OVERRIDE_STORAGE_KEY = 'conai.language.override'
const DEFAULT_CATALOG: TranslationCatalog = { ...shellCatalog, ...authCatalog }
let registeredCatalog: TranslationCatalog = { ...DEFAULT_CATALOG }
const catalogListeners = new Set<() => void>()

/** Register one route catalog before its lazy page renders. */
export function registerTranslationCatalog(catalog: TranslationCatalog): void {
  registeredCatalog = { ...registeredCatalog, ...catalog }
  catalogListeners.forEach((listener) => listener())
}

function subscribeCatalog(listener: () => void) {
  catalogListeners.add(listener)
  return () => catalogListeners.delete(listener)
}

function getRegisteredCatalog() {
  return registeredCatalog
}

export const SUPPORTED_LANGUAGES: AppLanguage[] = ['ko', 'en']

export const LOCALE_BY_LANGUAGE: Record<AppLanguage, string> = {
  ko: 'ko-KR',
  en: 'en-US',
}

interface I18nContextValue {
  language: AppLanguage
  locale: string
  t: (input: TranslationInput, params?: TranslationParams) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string
  formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string
  /** Language used when there is no per-browser override (server setting, or its last cached value). */
  defaultLanguage: AppLanguage
  languageOverride: AppLanguage | null
  /** Pick a per-browser language, or `null` to follow the server default again. */
  setLanguageOverride: (language: AppLanguage | null) => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function isSupportedLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value as AppLanguage)
}

export function normalizeLanguage(value: unknown): AppLanguage | null {
  if (isSupportedLanguage(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('ko')) {
    return 'ko'
  }
  if (normalized.startsWith('en')) {
    return 'en'
  }

  return null
}

export function getLocaleForLanguage(language: AppLanguage): string {
  return LOCALE_BY_LANGUAGE[language]
}

function readStoredValue(key: string): AppLanguage | null {
  try {
    return normalizeLanguage(window.localStorage.getItem(key))
  } catch {
    return null
  }
}

function writeStoredValue(key: string, language: AppLanguage | null): void {
  try {
    if (language) {
      window.localStorage.setItem(key, language)
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // localStorage may be unavailable in private/embed contexts. The provider still works without it.
  }
}

function readStoredDefaultLanguage(): AppLanguage | null {
  // Older builds only stored the effective language; use it as the default until the server value is seen.
  return readStoredValue(DEFAULT_LANGUAGE_STORAGE_KEY) ?? readStoredValue(LANGUAGE_STORAGE_KEY)
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key]
    return value === undefined || value === null ? match : String(value)
  })
}

function resolveTranslation(
  input: TranslationInput,
  language: AppLanguage,
  catalog: TranslationCatalog,
  params?: TranslationParams,
): string {
  if (typeof input === 'string') {
    const catalogEntry = catalog[input]
    return interpolate(catalogEntry?.[language] ?? catalogEntry?.[DEFAULT_LANGUAGE] ?? input, params)
  }

  return interpolate(input[language] ?? input[DEFAULT_LANGUAGE] ?? input.en ?? '', params)
}

function coerceDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value)
}

const DATE_TIME_COMPONENT_OPTION_KEYS: Array<keyof Intl.DateTimeFormatOptions> = [
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'dayPeriod',
  'hour',
  'minute',
  'second',
  'fractionalSecondDigits',
  'timeZoneName',
]

function hasExplicitDateTimeComponents(options?: Intl.DateTimeFormatOptions): boolean {
  if (!options) {
    return false
  }

  return DATE_TIME_COMPONENT_OPTION_KEYS.some((key) => options[key] !== undefined)
}

function withDefaultDateTimeOptions(
  options: Intl.DateTimeFormatOptions | undefined,
  defaults: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions {
  if (!options) {
    return defaults
  }

  if (options.dateStyle !== undefined || options.timeStyle !== undefined || hasExplicitDateTimeComponents(options)) {
    return options
  }

  return { ...defaults, ...options }
}

/**
 * `Intl.NumberFormat` 생성은 포맷 1회보다 훨씬 비싸다. 큐 헤더 위젯처럼 렌더마다
 * 레코드당 수 회 호출하는 소비처가 있으므로 locale+options 조합별로 인스턴스를 재사용한다.
 * 키는 options 의 JSON 직렬화 — 호출부가 리터럴 옵션을 쓰므로 조합 수는 소수로 유계다.
 */
const numberFormatCache = new Map<string, Intl.NumberFormat>()

function getCachedNumberFormat(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = options ? `${locale}|${JSON.stringify(options)}` : locale
  let format = numberFormatCache.get(cacheKey)
  if (!format) {
    format = new Intl.NumberFormat(locale, options)
    numberFormatCache.set(cacheKey, format)
  }
  return format
}

export function I18nProvider({ children, catalog = DEFAULT_CATALOG }: PropsWithChildren<{ catalog?: TranslationCatalog }>) {
  const registeredCatalogSnapshot = useSyncExternalStore(subscribeCatalog, getRegisteredCatalog, getRegisteredCatalog)
  const storedDefaultLanguage = useMemo(() => readStoredDefaultLanguage(), [])
  const [languageOverride, setLanguageOverrideState] = useState<AppLanguage | null>(() => readStoredValue(LANGUAGE_OVERRIDE_STORAGE_KEY))
  const settingsQuery = useQuery({
    queryKey: ['runtime-language-settings'],
    queryFn: getRuntimeLanguageSettings,
    retry: false,
    staleTime: 30_000,
  })

  const serverLanguage = normalizeLanguage(settingsQuery.data?.general.language)
  const defaultLanguage = serverLanguage ?? storedDefaultLanguage ?? DEFAULT_LANGUAGE
  const language = languageOverride ?? defaultLanguage
  const locale = getLocaleForLanguage(language)

  const setLanguageOverride = useCallback((nextLanguage: AppLanguage | null) => {
    setLanguageOverrideState(nextLanguage)
    writeStoredValue(LANGUAGE_OVERRIDE_STORAGE_KEY, nextLanguage)
  }, [])

  useEffect(() => {
    // Keep other tabs of this browser in step with the account-menu choice.
    const handleStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_OVERRIDE_STORAGE_KEY || event.key === null) {
        setLanguageOverrideState(readStoredValue(LANGUAGE_OVERRIDE_STORAGE_KEY))
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  useEffect(() => {
    if (serverLanguage) {
      writeStoredValue(DEFAULT_LANGUAGE_STORAGE_KEY, serverLanguage)
    }
  }, [serverLanguage])

  useEffect(() => {
    document.documentElement.lang = language
    writeStoredValue(LANGUAGE_STORAGE_KEY, language)
  }, [language])

  const activeCatalog = useMemo(
    () => ({ ...registeredCatalogSnapshot, ...catalog }),
    [catalog, registeredCatalogSnapshot],
  )

  const t = useCallback<I18nContextValue['t']>(
    (input, params) => resolveTranslation(input, language, activeCatalog, params),
    [activeCatalog, language],
  )

  const formatNumber = useCallback<I18nContextValue['formatNumber']>(
    (value, options) => getCachedNumberFormat(locale, options).format(value),
    [locale],
  )

  const formatDate = useCallback<I18nContextValue['formatDate']>(
    (value, options) => new Intl.DateTimeFormat(locale, withDefaultDateTimeOptions(options, { dateStyle: 'medium' })).format(coerceDate(value)),
    [locale],
  )

  const formatDateTime = useCallback<I18nContextValue['formatDateTime']>(
    (value, options) => new Intl.DateTimeFormat(locale, withDefaultDateTimeOptions(options, { dateStyle: 'medium', timeStyle: 'short' })).format(coerceDate(value)),
    [locale],
  )

  const contextValue = useMemo<I18nContextValue>(
    () => ({ language, locale, t, formatNumber, formatDate, formatDateTime, defaultLanguage, languageOverride, setLanguageOverride }),
    [defaultLanguage, formatDate, formatDateTime, formatNumber, language, languageOverride, locale, setLanguageOverride, t],
  )

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return context
}

export function useLanguage(): AppLanguage {
  return useI18n().language
}

export function useLocale(): string {
  return useI18n().locale
}
