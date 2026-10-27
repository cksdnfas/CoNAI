import { createTranslationCatalog, type ScopedLocaleResources } from './types'

export const charactersResources = {
  ko: {
    "characterLibraryPage.title": "캐릭터 라이브러리",
    "characterLibraryPage.folders": "폴더",
    "characterLibraryPage.settings": "외형 설정",
  },
  en: {
    "characterLibraryPage.title": "Character library",
    "characterLibraryPage.folders": "Folders",
    "characterLibraryPage.settings": "Appearance settings",
  },
} as const satisfies ScopedLocaleResources

export const charactersCatalog = createTranslationCatalog(charactersResources)

export type CharactersResourceKey = keyof typeof charactersResources.ko
