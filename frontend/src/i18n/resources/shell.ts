import { createTranslationCatalog, type ScopedLocaleResources } from './types'

// Auto-extracted from tmp/agent-scratch/frontend-english-only.patch.
// Korean remains the default/source language; English mirrors the prior English-only patch.

export const shellResources = {
  ko: {
    "routeErrorBoundary.anUnknownErrorOccurred": "알 수 없는 오류가 발생했어.",
    "routeErrorBoundary.appResourcesNeedToBe": "앱 리소스를 다시 불러와야 해",
    "routeErrorBoundary.anUnexpectedErrorOccurred": "예상치 못한 오류가 발생했어",
    "extractedPromptLabels.positivePrompt": "포지티브 프롬프트",
    "extractedPromptLabels.negativePrompt": "네거티브 프롬프트",
    "extractedPromptLabels.character": "캐릭터",
    "extractedPromptLabels.characterIndexed": "캐릭터 {index}",
    "extractedPromptLabels.processedBadge": "가공됨",
    "extractedPromptLabels.unclassified": "미분류",
    "kaloscopeResultBlock.kaloscopeResults": "Kaloscope 결과",
    "selectionActionBar.clearSelection": "선택 해제",
    "wdTaggerResultBlock.wdTaggerResults": "WD Tagger 결과",
    "appShell.availablePages": "이용 가능 페이지",
    "appShell.mainPageNavigation": "주요 페이지 이동",
    "imageSaveOptionsModal.saveImage": "이미지 저장",
    "imageSaveOptionsModal.keepOriginal": "원본 유지",
    "imageSaveOptionsModal.maxWidth": "최대 가로",
    "imageSaveOptionsModal.maxHeight": "최대 세로",
  },
  en: {
    "routeErrorBoundary.anUnknownErrorOccurred": "An unknown error occurred.",
    "routeErrorBoundary.appResourcesNeedToBe": "App resources need to be reloaded",
    "routeErrorBoundary.anUnexpectedErrorOccurred": "An unexpected error occurred",
    "extractedPromptLabels.positivePrompt": "Positive prompt",
    "extractedPromptLabels.negativePrompt": "Negative prompt",
    "extractedPromptLabels.character": "Character",
    "extractedPromptLabels.characterIndexed": "Character {index}",
    "extractedPromptLabels.processedBadge": "Processed",
    "extractedPromptLabels.unclassified": "Unclassified",
    "kaloscopeResultBlock.kaloscopeResults": "Kaloscope results",
    "selectionActionBar.clearSelection": "Clear selection",
    "wdTaggerResultBlock.wdTaggerResults": "WD Tagger results",
    "appShell.availablePages": "Available Pages",
    "appShell.mainPageNavigation": "Main page navigation",
    "imageSaveOptionsModal.saveImage": "Save image",
    "imageSaveOptionsModal.keepOriginal": "Keep original",
    "imageSaveOptionsModal.maxWidth": "Max width",
    "imageSaveOptionsModal.maxHeight": "Max height",
  },
} as const satisfies ScopedLocaleResources

export const shellCatalog = createTranslationCatalog(shellResources)

export type ShellResourceKey = keyof typeof shellResources.ko
