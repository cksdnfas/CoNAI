import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type PropsWithChildren,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAppSettings } from '@/lib/api-settings'
import type { GeneralSettings } from '@/types/settings'
import { featureLocaleCatalog } from './resources'

export type AppLanguage = GeneralSettings['language']
export type TranslationDictionary = Partial<Record<AppLanguage, string>>
export type TranslationInput = string | TranslationDictionary
export type TranslationParams = Record<string, string | number | boolean | null | undefined>
export type TranslationCatalog = Record<string, TranslationDictionary>

const DEFAULT_LANGUAGE: AppLanguage = 'ko'
const LANGUAGE_STORAGE_KEY = 'conai.language'
const DEFAULT_CATALOG: TranslationCatalog = featureLocaleCatalog

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

function readStoredLanguage(): AppLanguage | null {
  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    return null
  }
}

function writeStoredLanguage(language: AppLanguage): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // localStorage may be unavailable in private/embed contexts. The provider still works without it.
  }
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

export function I18nProvider({ children, catalog = DEFAULT_CATALOG }: PropsWithChildren<{ catalog?: TranslationCatalog }>) {
  const storedLanguage = useMemo(() => readStoredLanguage(), [])
  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
    retry: false,
    staleTime: 30_000,
  })

  const language = normalizeLanguage(settingsQuery.data?.general.language) ?? storedLanguage ?? DEFAULT_LANGUAGE
  const locale = getLocaleForLanguage(language)

  useEffect(() => {
    document.documentElement.lang = language
    writeStoredLanguage(language)
  }, [language])

  const t = useCallback<I18nContextValue['t']>(
    (input, params) => resolveTranslation(input, language, catalog, params),
    [catalog, language],
  )

  const formatNumber = useCallback<I18nContextValue['formatNumber']>(
    (value, options) => new Intl.NumberFormat(locale, options).format(value),
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
    () => ({ language, locale, t, formatNumber, formatDate, formatDateTime }),
    [formatDate, formatDateTime, formatNumber, language, locale, t],
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
