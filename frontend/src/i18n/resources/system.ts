import { createTranslationCatalog, type ScopedLocaleResources } from './types'

// Auto-extracted from tmp/agent-scratch/frontend-english-only.patch.
// Korean remains the default/source language; English mirrors the prior English-only patch.

export const systemResources = {
  ko: {
    "notFoundPage.pageNotFound": "페이지를 찾지 못했어",
    "notFoundPage.goToHome": "홈으로 이동",
  },
  en: {
    "notFoundPage.pageNotFound": "Page not found",
    "notFoundPage.goToHome": "Go to Home",
  },
} as const satisfies ScopedLocaleResources

export const systemCatalog = createTranslationCatalog(systemResources)

export type SystemResourceKey = keyof typeof systemResources.ko
