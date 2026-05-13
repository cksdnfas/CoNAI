export const API_ERROR_FALLBACKS = {
  'auth.emptyResponse': {
    ko: '빈 응답을 받았어.',
    en: 'Received an empty response.',
  },
  'groups.hierarchy.load': {
    ko: '그룹 계층을 불러오지 못했어.',
    en: 'Failed to load the group hierarchy.',
  },
  'groups.detail.load': {
    ko: '그룹 정보를 불러오지 못했어.',
    en: 'Failed to load the group details.',
  },
  'groups.breadcrumb.load': {
    ko: '그룹 경로를 불러오지 못했어.',
    en: 'Failed to load the group path.',
  },
  'groups.images.load': {
    ko: '그룹 이미지를 불러오지 못했어.',
    en: 'Failed to load group images.',
  },
  'groups.create': {
    ko: '그룹을 만들지 못했어.',
    en: 'Failed to create the group.',
  },
  'groups.update': {
    ko: '그룹을 수정하지 못했어.',
    en: 'Failed to update the group.',
  },
  'groups.delete': {
    ko: '그룹을 삭제하지 못했어.',
    en: 'Failed to delete the group.',
  },
  'groups.image.add': {
    ko: '이미지를 그룹에 추가하지 못했어.',
    en: 'Failed to add the image to the group.',
  },
  'groups.images.remove': {
    ko: '이미지를 그룹에서 제거하지 못했어.',
    en: 'Failed to remove images from the group.',
  },
  'groups.autoCollect.run': {
    ko: '자동수집을 실행하지 못했어.',
    en: 'Failed to run auto-collect.',
  },
  'groups.autoCollectAll.run': {
    ko: '전체 자동수집을 실행하지 못했어.',
    en: 'Failed to run auto-collect for all groups.',
  },
  'groups.fileCounts.load': {
    ko: '그룹 다운로드 가능 파일 수를 불러오지 못했어.',
    en: 'Failed to load the downloadable file count for the group.',
  },
  'groups.preview.load': {
    ko: '그룹 미리보기를 불러오지 못했어.',
    en: 'Failed to load the group preview.',
  },
  'images.list.load': {
    ko: '이미지 목록을 불러오지 못했어.',
    en: 'Failed to load the image list.',
  },
  'images.search.load': {
    ko: '검색 결과를 불러오지 못했어.',
    en: 'Failed to load search results.',
  },
  'images.detail.load': {
    ko: '이미지를 불러오지 못했어.',
    en: 'Failed to load the image.',
  },
  'images.bulkDelete': {
    ko: '이미지 삭제에 실패했어.',
    en: 'Failed to delete images.',
  },
  'images.duplicates.load': {
    ko: '중복 이미지를 불러오지 못했어.',
    en: 'Failed to load duplicate images.',
  },
  'images.similar.load': {
    ko: '유사 이미지를 불러오지 못했어.',
    en: 'Failed to load similar images.',
  },
  'images.promptSimilar.load': {
    ko: '텍스트 기반 유사 이미지를 불러오지 못했어.',
    en: 'Failed to load text-based similar images.',
  },
  'images.edit.save': {
    ko: '편집 이미지를 저장하지 못했어.',
    en: 'Failed to save the edited image.',
  },
  'settings.app.load': {
    ko: '설정을 불러오지 못했어.',
    en: 'Failed to load settings.',
  },
  'settings.appearancePublic.load': {
    ko: '공용 화면 설정을 불러오지 못했어.',
    en: 'Failed to load public appearance settings.',
  },
  'settings.runtimeSimilarity.load': {
    ko: '런타임 유사도 설정을 불러오지 못했어.',
    en: 'Failed to load runtime similarity settings.',
  },
  'settings.wallpaperRuntime.load': {
    ko: '월페이퍼 라이브 설정을 불러오지 못했어.',
    en: 'Failed to load wallpaper live settings.',
  },
  'settings.fileVerification.run': {
    ko: '파일 검증을 실행하지 못했어.',
    en: 'Failed to run file verification.',
  },
  'settings.general.update': {
    ko: '일반 설정을 저장하지 못했어.',
    en: 'Failed to save general settings.',
  },
  'settings.metadata.update': {
    ko: '메타데이터 추출 설정을 저장하지 못했어.',
    en: 'Failed to save metadata extraction settings.',
  },
  'settings.metadata.reextractAll': {
    ko: '전체 메타데이터 재추출을 시작하지 못했어.',
    en: 'Failed to start metadata re-extraction for all images.',
  },
  'settings.appearance.update': {
    ko: '화면 설정을 저장하지 못했어.',
    en: 'Failed to save appearance settings.',
  },
  'settings.imageSave.update': {
    ko: '이미지 저장 설정을 저장하지 못했어.',
    en: 'Failed to save image save settings.',
  },
  'settings.generationThrottle.update': {
    ko: '생성 텀 설정을 저장하지 못했어.',
    en: 'Failed to save generation throttle settings.',
  },
  'settings.videoOptimization.update': {
    ko: '비디오 최적화 설정을 저장하지 못했어.',
    en: 'Failed to save video optimization settings.',
  },
  'settings.llm.update': {
    ko: 'LLM 설정을 저장하지 못했어.',
    en: 'Failed to save LLM settings.',
  },
  'settings.llmPresets.load': {
    ko: 'LLM 프리셋 목록을 불러오지 못했어.',
    en: 'Failed to load LLM presets.',
  },
  'settings.appearanceFont.upload': {
    ko: '커스텀 폰트 업로드에 실패했어.',
    en: 'Failed to upload the custom font.',
  },
  'settings.tagger.update': {
    ko: '태거 설정을 저장하지 못했어.',
    en: 'Failed to save tagger settings.',
  },
  'settings.taggerModels.load': {
    ko: '태거 모델 목록을 불러오지 못했어.',
    en: 'Failed to load tagger models.',
  },
  'settings.taggerStatus.load': {
    ko: '태거 상태를 불러오지 못했어.',
    en: 'Failed to load tagger status.',
  },
  'settings.taggerDependencies.check': {
    ko: '태거 의존성을 확인하지 못했어.',
    en: 'Failed to check tagger dependencies.',
  },
  'settings.kaloscope.update': {
    ko: 'Kaloscope 설정을 저장하지 못했어.',
    en: 'Failed to save Kaloscope settings.',
  },
  'settings.ratingWeights.load': {
    ko: '평가 가중치를 불러오지 못했어.',
    en: 'Failed to load rating weights.',
  },
  'settings.ratingWeights.update': {
    ko: '평가 가중치를 저장하지 못했어.',
    en: 'Failed to save rating weights.',
  },
  'settings.ratingTiers.update': {
    ko: '평가 등급 설정을 저장하지 못했어.',
    en: 'Failed to save rating tier settings.',
  },
  'settings.kaloscopeStatus.load': {
    ko: 'Kaloscope 상태를 불러오지 못했어.',
    en: 'Failed to load Kaloscope status.',
  },
  'settings.autoTestMedia.resolve': {
    ko: '테스트 대상을 찾지 못했어.',
    en: 'Could not find the test target.',
  },
  'settings.autoTestMedia.random': {
    ko: '랜덤 테스트 대상을 고르지 못했어.',
    en: 'Could not choose a random test target.',
  },
  'settings.taggerAutoTest.run': {
    ko: '태거 테스트에 실패했어.',
    en: 'Tagger test failed.',
  },
  'settings.kaloscopeAutoTest.run': {
    ko: 'Kaloscope 테스트에 실패했어.',
    en: 'Kaloscope test failed.',
  },
  'settings.similarity.update': {
    ko: '유사도 설정을 저장하지 못했어.',
    en: 'Failed to save similarity settings.',
  },
  'prompts.groups.load': {
    ko: '프롬프트 그룹을 불러오지 못했어.',
    en: 'Failed to load prompt groups.',
  },
  'prompts.collection.search': {
    ko: '프롬프트 목록을 불러오지 못했어.',
    en: 'Failed to load prompts.',
  },
  'prompts.statistics.load': {
    ko: '프롬프트 통계를 불러오지 못했어.',
    en: 'Failed to load prompt statistics.',
  },
  'prompts.danbooruGrouping.preview': {
    ko: '단부루 기반 그룹 미리보기를 불러오지 못했어.',
    en: 'Failed to load the Danbooru-based group preview.',
  },
  'prompts.danbooruGrouping.apply': {
    ko: '단부루 기반 그룹 자동 구성을 적용하지 못했어.',
    en: 'Failed to apply Danbooru-based group auto-organization.',
  },
  'prompts.groups.resolve': {
    ko: '프롬프트 그룹 정렬 정보를 불러오지 못했어.',
    en: 'Failed to load prompt group assignment information.',
  },
  'prompts.top.load': {
    ko: '상위 프롬프트를 불러오지 못했어.',
    en: 'Failed to load top prompts.',
  },
  'prompts.group.assign': {
    ko: '프롬프트 그룹 지정에 실패했어.',
    en: 'Failed to assign the prompt group.',
  },
  'prompts.group.batchAssign': {
    ko: '프롬프트 일괄 그룹 지정에 실패했어.',
    en: 'Failed to assign prompt groups in bulk.',
  },
  'prompts.groups.create': {
    ko: '프롬프트 그룹 생성에 실패했어.',
    en: 'Failed to create the prompt group.',
  },
  'prompts.groups.update': {
    ko: '프롬프트 그룹 수정에 실패했어.',
    en: 'Failed to update the prompt group.',
  },
  'prompts.groups.delete': {
    ko: '프롬프트 그룹 삭제에 실패했어.',
    en: 'Failed to delete the prompt group.',
  },
  'prompts.groups.reorder': {
    ko: '프롬프트 그룹 순서 변경에 실패했어.',
    en: 'Failed to reorder prompt groups.',
  },
  'prompts.groupStatistics.load': {
    ko: '프롬프트 그룹 통계를 불러오지 못했어.',
    en: 'Failed to load prompt group statistics.',
  },
  'prompts.groups.import': {
    ko: '프롬프트 그룹 가져오기에 실패했어.',
    en: 'Failed to import prompt groups.',
  },
  'prompts.item.delete': {
    ko: '프롬프트 삭제에 실패했어.',
    en: 'Failed to delete the prompt.',
  },
  'prompts.collect.run': {
    ko: '프롬프트 수집 실행에 실패했어.',
    en: 'Failed to run prompt collection.',
  },
  'promptPresets.list.load': {
    ko: '프리셋 목록을 불러오지 못했어.',
    en: 'Failed to load prompt presets.',
  },
  'promptPresets.create': {
    ko: '프리셋을 만들지 못했어.',
    en: 'Failed to create the prompt preset.',
  },
  'promptPresets.update': {
    ko: '프리셋을 저장하지 못했어.',
    en: 'Failed to save the prompt preset.',
  },
  'promptPresets.delete': {
    ko: '프리셋을 삭제하지 못했어.',
    en: 'Failed to delete the prompt preset.',
  },
  'search.history.load': {
    ko: '검색 히스토리를 불러오지 못했어.',
    en: 'Failed to load search history.',
  },
  'search.history.save': {
    ko: '검색 히스토리를 저장하지 못했어.',
    en: 'Failed to save search history.',
  },
  'search.history.delete': {
    ko: '검색 히스토리 삭제에 실패했어.',
    en: 'Failed to delete the search history entry.',
  },
  'search.history.clear': {
    ko: '검색 히스토리를 비우지 못했어.',
    en: 'Failed to clear search history.',
  },
  'search.ratingTiers.load': {
    ko: '평가 티어를 불러오지 못했어.',
    en: 'Failed to load rating tiers.',
  },
  'search.modelSuggestions.load': {
    ko: '모델 추천 목록을 불러오지 못했어.',
    en: 'Failed to load model suggestions.',
  },
  'search.loraSuggestions.load': {
    ko: 'LoRA 추천 목록을 불러오지 못했어.',
    en: 'Failed to load LoRA suggestions.',
  },
  'wildcards.list.load': {
    ko: '와일드카드 목록을 불러오지 못했어.',
    en: 'Failed to load wildcards.',
  },
  'wildcards.create': {
    ko: '항목을 만들지 못했어.',
    en: 'Failed to create the wildcard item.',
  },
  'wildcards.update': {
    ko: '항목을 저장하지 못했어.',
    en: 'Failed to save the wildcard item.',
  },
  'wildcards.delete': {
    ko: '항목을 삭제하지 못했어.',
    en: 'Failed to delete the wildcard item.',
  },
  'wildcards.lastScanLog.load': {
    ko: '최근 LoRA 스캔 로그를 불러오지 못했어.',
    en: 'Failed to load the latest LoRA scan log.',
  },
  'wildcards.loraScan.run': {
    ko: 'LoRA 자동 수집에 실패했어.',
    en: 'Failed to run LoRA auto-collection.',
  },
  'wildcards.preview.parse': {
    ko: '와일드카드 프리뷰 생성에 실패했어.',
    en: 'Failed to generate the wildcard preview.',
  },
  'autoFolderGroups.hierarchy.load': {
    ko: '감시폴더 그룹을 불러오지 못했어.',
    en: 'Failed to load auto-folder groups.',
  },
  'autoFolderGroups.detail.load': {
    ko: '감시폴더 그룹 정보를 불러오지 못했어.',
    en: 'Failed to load auto-folder group details.',
  },
  'autoFolderGroups.breadcrumb.load': {
    ko: '감시폴더 그룹 경로를 불러오지 못했어.',
    en: 'Failed to load the auto-folder group path.',
  },
  'autoFolderGroups.images.load': {
    ko: '감시폴더 그룹 이미지를 불러오지 못했어.',
    en: 'Failed to load auto-folder group images.',
  },
  'autoFolderGroups.fileCounts.load': {
    ko: '감시폴더 그룹 다운로드 가능 파일 수를 불러오지 못했어.',
    en: 'Failed to load the downloadable file count for the auto-folder group.',
  },
  'autoFolderGroups.rebuild': {
    ko: '감시폴더 그룹 재구축에 실패했어.',
    en: 'Failed to rebuild auto-folder groups.',
  },
  'autoFolderGroups.preview.load': {
    ko: '감시폴더 그룹 미리보기를 불러오지 못했어.',
    en: 'Failed to load the auto-folder group preview.',
  },
  'backupSources.list.load': {
    ko: '백업 소스를 불러오지 못했어.',
    en: 'Failed to load backup sources.',
  },
  'backupSources.create': {
    ko: '백업 소스를 추가하지 못했어.',
    en: 'Failed to add the backup source.',
  },
  'backupSources.update': {
    ko: '백업 소스를 저장하지 못했어.',
    en: 'Failed to save the backup source.',
  },
  'backupSources.delete': {
    ko: '백업 소스를 삭제하지 못했어.',
    en: 'Failed to delete the backup source.',
  },
  'backupSources.path.validate': {
    ko: '백업 source 경로를 검증하지 못했어.',
    en: 'Failed to validate the backup source path.',
  },
  'backupSources.watcher.start': {
    ko: '백업 source watcher를 시작하지 못했어.',
    en: 'Failed to start the backup source watcher.',
  },
  'backupSources.watcher.stop': {
    ko: '백업 source watcher를 중지하지 못했어.',
    en: 'Failed to stop the backup source watcher.',
  },
  'backupSources.watcher.restart': {
    ko: '백업 source watcher를 재시작하지 못했어.',
    en: 'Failed to restart the backup source watcher.',
  },
  'customNodes.list.load': {
    ko: '커스텀 노드 목록을 불러오지 못했어.',
    en: 'Failed to load custom nodes.',
  },
  'customNodes.rescan': {
    ko: '커스텀 노드를 다시 스캔하지 못했어.',
    en: 'Failed to rescan custom nodes.',
  },
  'customNodes.scaffold': {
    ko: '커스텀 노드 스캐폴드를 만들지 못했어.',
    en: 'Failed to create the custom node scaffold.',
  },
  'customNodes.source.load': {
    ko: '커스텀 노드 소스를 불러오지 못했어.',
    en: 'Failed to load the custom node source.',
  },
  'customNodes.folder.open': {
    ko: '커스텀 노드 폴더를 열지 못했어.',
    en: 'Failed to open the custom node folder.',
  },
  'customNodes.dependencies.install': {
    ko: '커스텀 노드 의존성 설치에 실패했어.',
    en: 'Failed to install custom node dependencies.',
  },
  'customNodes.test.run': {
    ko: '커스텀 노드 테스트 실행에 실패했어.',
    en: 'Failed to run the custom node test.',
  },
  'folders.list.load': {
    ko: '감시 폴더를 불러오지 못했어.',
    en: 'Failed to load watched folders.',
  },
  'folders.create': {
    ko: '감시 폴더를 추가하지 못했어.',
    en: 'Failed to add the watched folder.',
  },
  'folders.update': {
    ko: '감시 폴더를 저장하지 못했어.',
    en: 'Failed to save the watched folder.',
  },
  'folders.delete': {
    ko: '감시 폴더를 삭제하지 못했어.',
    en: 'Failed to delete the watched folder.',
  },
  'folders.path.validate': {
    ko: '폴더 경로를 검증하지 못했어.',
    en: 'Failed to validate the folder path.',
  },
  'folders.scan.run': {
    ko: '폴더 스캔을 실행하지 못했어.',
    en: 'Failed to run the folder scan.',
  },
  'folders.scanAll.run': {
    ko: '전체 폴더 스캔을 실행하지 못했어.',
    en: 'Failed to run the scan for all folders.',
  },
  'folders.scanLogs.load': {
    ko: '최근 스캔 로그를 불러오지 못했어.',
    en: 'Failed to load recent scan logs.',
  },
  'folders.watchersHealth.load': {
    ko: '워처 상태를 불러오지 못했어.',
    en: 'Failed to load watcher health.',
  },
  'folders.watcher.start': {
    ko: '워처를 시작하지 못했어.',
    en: 'Failed to start the watcher.',
  },
  'folders.watcher.stop': {
    ko: '워처를 중지하지 못했어.',
    en: 'Failed to stop the watcher.',
  },
  'folders.watcher.restart': {
    ko: '워처를 재시작하지 못했어.',
    en: 'Failed to restart the watcher.',
  },
  'wallpaperRuntime.browseContent.load': {
    ko: '월페이퍼 라이브 데이터를 불러오지 못했어.',
    en: 'Failed to load wallpaper live data.',
  },
  'wallpaperRuntime.groupPreview.load': {
    ko: '월페이퍼 라이브 그룹 미리보기를 불러오지 못했어.',
    en: 'Failed to load the wallpaper live group preview.',
  },
} as const

export type ApiErrorFallbackKey = keyof typeof API_ERROR_FALLBACKS
export type ApiErrorFallbackLanguage = keyof (typeof API_ERROR_FALLBACKS)[ApiErrorFallbackKey]

const FALLBACK_LANGUAGE: ApiErrorFallbackLanguage = 'ko'
const LANGUAGE_STORAGE_KEY = 'conai.language'

function normalizeApiErrorFallbackLanguage(value: unknown): ApiErrorFallbackLanguage | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('en')) {
    return 'en'
  }
  if (normalized.startsWith('ko')) {
    return 'ko'
  }
  return null
}

function readStoredApiErrorFallbackLanguage(): ApiErrorFallbackLanguage {
  if (typeof window === 'undefined') {
    return FALLBACK_LANGUAGE
  }

  try {
    return normalizeApiErrorFallbackLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)) ?? FALLBACK_LANGUAGE
  } catch {
    return FALLBACK_LANGUAGE
  }
}

export function getApiErrorFallbackMessage(fallbackKey: ApiErrorFallbackKey, language = readStoredApiErrorFallbackLanguage()) {
  const fallback = API_ERROR_FALLBACKS[fallbackKey]
  return fallback[language] ?? fallback[FALLBACK_LANGUAGE]
}

export class ApiFallbackError extends Error {
  readonly fallbackKey: ApiErrorFallbackKey
  readonly backendMessage: string | null

  constructor(backendMessage: unknown, fallbackKey: ApiErrorFallbackKey) {
    const normalizedBackendMessage = typeof backendMessage === 'string' && backendMessage.trim().length > 0 ? backendMessage : null
    super(normalizedBackendMessage ?? getApiErrorFallbackMessage(fallbackKey))
    this.name = 'ApiFallbackError'
    this.fallbackKey = fallbackKey
    this.backendMessage = normalizedBackendMessage
  }
}

export function createApiFallbackError(backendMessage: unknown, fallbackKey: ApiErrorFallbackKey) {
  return new ApiFallbackError(backendMessage, fallbackKey)
}
