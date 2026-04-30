import { createTranslationCatalog, type ScopedLocaleResources } from './types'

// Auto-extracted from tmp/agent-scratch/frontend-english-only.patch.
// Korean remains the default/source language; English mirrors the prior English-only patch.

export const shellResources = {
  ko: {
    "routeErrorBoundary.anUnknownErrorOccurred": "알 수 없는 오류가 발생했어.",
    "routeErrorBoundary.appResourcesNeedToBe": "앱 리소스를 다시 불러와야 해",
    "routeErrorBoundary.anUnexpectedErrorOccurred": "예상치 못한 오류가 발생했어",
    "routeErrorBoundary.thisCanHappenRightAfter": "배포 직후나 오래 열어둔 탭에서 예전 청크 파일을 보다가 이런 오류가 날 수 있어.",
    "routeErrorBoundary.aRefreshUsuallyFixesIt": "보통 새로고침하면 바로 복구돼. 그래도 계속 뜨면 서버의 최신 프론트 번들과 캐시 상태를 더 확인해야 해.",
    "explorerSidebar.unlockSidebar": "사이드바 고정 해제",
    "explorerSidebar.lockSidebar": "사이드바 고정",
    "extractedPromptSections.valueCopiedToTheClipboard": "{item.title}를 클립보드에 복사했어.",
    "extractedPromptSections.valueCopyFailed": "{item.title} 복사에 실패했어.",
    "extractedPromptSections.valueCollapse": "{item.title} 접기",
    "extractedPromptSections.valueExpand": "{item.title} 펼치기",
    "extractedPromptSections.valueCopy": "{item.title} 복사",
    "hierarchyPicker.rootGroup": "루트 그룹",
    "kaloscopeResultBlock.kaloscopeResults": "Kaloscope 결과",
    "selectionActionBar.clearSelection": "선택 해제",
    "tagResultUi.valueOpenLink": "{tag} 링크 열기",
    "wdTaggerResultBlock.wdTaggerResults": "WD Tagger 결과",
    "appShell.availablePages": "이용 가능 페이지",
    "appShell.mainPageNavigation": "주요 페이지 이동",
    "imageSaveOptionsModal.saveImage": "이미지 저장",
    "imageSaveOptionsModal.keepOriginal": "원본 유지",
    "imageSaveOptionsModal.maxWidth": "최대 가로",
    "imageSaveOptionsModal.maxHeight": "최대 세로",
    "scrubbableNumberInput.dragLeftOrRightTo": "좌우로 드래그해서 값 조절",
  },
  en: {
    "routeErrorBoundary.anUnknownErrorOccurred": "An unknown error occurred.",
    "routeErrorBoundary.appResourcesNeedToBe": "App resources need to be reloaded",
    "routeErrorBoundary.anUnexpectedErrorOccurred": "An unexpected error occurred",
    "routeErrorBoundary.thisCanHappenRightAfter": "This can happen right after a deployment or when an old tab is still using outdated chunk files.",
    "routeErrorBoundary.aRefreshUsuallyFixesIt": "A refresh usually fixes it. If it keeps happening, check the latest frontend bundle and server cache state.",
    "explorerSidebar.unlockSidebar": "Unlock sidebar",
    "explorerSidebar.lockSidebar": "Lock sidebar",
    "extractedPromptSections.valueCopiedToTheClipboard": "{item.title} copied to the clipboard.",
    "extractedPromptSections.valueCopyFailed": "{item.title} copy failed.",
    "extractedPromptSections.valueCollapse": "{item.title} Collapse",
    "extractedPromptSections.valueExpand": "{item.title} Expand",
    "extractedPromptSections.valueCopy": "{item.title} copy",
    "hierarchyPicker.rootGroup": "Root group",
    "kaloscopeResultBlock.kaloscopeResults": "Kaloscope results",
    "selectionActionBar.clearSelection": "Clear selection",
    "tagResultUi.valueOpenLink": "{tag} Open link",
    "wdTaggerResultBlock.wdTaggerResults": "WD Tagger results",
    "appShell.availablePages": "Available Pages",
    "appShell.mainPageNavigation": "Main page navigation",
    "imageSaveOptionsModal.saveImage": "Save image",
    "imageSaveOptionsModal.keepOriginal": "Keep original",
    "imageSaveOptionsModal.maxWidth": "Max width",
    "imageSaveOptionsModal.maxHeight": "Max height",
    "scrubbableNumberInput.dragLeftOrRightTo": "Drag left or right to adjust the value",
  },
} as const satisfies ScopedLocaleResources

export const shellCatalog = createTranslationCatalog(shellResources)

export type ShellResourceKey = keyof typeof shellResources.ko
