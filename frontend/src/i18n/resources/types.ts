export type LocaleCode = 'ko' | 'en'

export type ScopedLocaleResources = {
  readonly ko: Record<string, string>
  readonly en: Record<string, string>
}

export type TranslationDictionary = Partial<Record<LocaleCode, string>>
export type TranslationCatalog = Record<string, TranslationDictionary>

export function createTranslationCatalog(resources: ScopedLocaleResources): TranslationCatalog {
  const catalog: TranslationCatalog = {}
  for (const key of Object.keys(resources.ko)) {
    catalog[key] = {
      ko: resources.ko[key],
      en: resources.en[key] ?? resources.ko[key],
    }
  }
  return catalog
}
