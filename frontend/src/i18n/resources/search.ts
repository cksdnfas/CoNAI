import { createTranslationCatalog, type ScopedLocaleResources } from './types'

export const searchResources = {
  ko: {
  "search.components.search.chip.list.no.condition.chips.yet": "아직 추가된 조건 칩이 없어.",
  "search.components.search.chip.list.click.to.cycle.or.and.not": "클릭해서 OR / AND / NOT 전환",
  "search.components.search.scope.tabs.previous.filter.item": "이전 필터 항목",
  "search.components.search.scope.tabs.next.filter.item": "다음 필터 항목",
  "search.components.search.suggestion.list.no.matching.prompt.suggestions": "일치하는 추천 프롬프트가 없어.",
  "search.components.search.suggestion.list.no.rating.tiers.available": "사용 가능한 평가 티어가 없어.",
  "search.components.search.suggestion.list.enter.a.search.term": "검색어 입력",
  "search.components.search.suggestion.list.loading.suggestions": "추천 항목을 불러오는 중…",
  "search.components.search.suggestion.list.loading.rating.tiers": "평가 티어를 불러오는 중…",
  "search.components.search.suggestion.list.model": "모델",
  "search.components.search.suggestion.list.value.loading.suggestions": "{metadataLabel} 추천을 불러오는 중…",
  "search.search.constants.positive": "긍정",
  "search.search.constants.negative": "부정",
  "search.search.constants.auto": "오토",
  "search.search.constants.rating": "평가",
  "search.search.constants.model": "모델",
},
  en: {
  "search.components.search.chip.list.no.condition.chips.yet": "No condition chips yet.",
  "search.components.search.chip.list.click.to.cycle.or.and.not": "Click to cycle OR / AND / NOT",
  "search.components.search.scope.tabs.previous.filter.item": "Previous filter item",
  "search.components.search.scope.tabs.next.filter.item": "Next filter item",
  "search.components.search.suggestion.list.no.matching.prompt.suggestions": "No matching prompt suggestions.",
  "search.components.search.suggestion.list.no.rating.tiers.available": "No rating tiers available.",
  "search.components.search.suggestion.list.enter.a.search.term": "Enter a search term",
  "search.components.search.suggestion.list.loading.suggestions": "Loading suggestions…",
  "search.components.search.suggestion.list.loading.rating.tiers": "Loading rating tiers…",
  "search.components.search.suggestion.list.model": "Model",
  "search.components.search.suggestion.list.value.loading.suggestions": "{metadataLabel} Loading suggestions…",
  "search.search.constants.positive": "Positive",
  "search.search.constants.negative": "Negative",
  "search.search.constants.auto": "Auto",
  "search.search.constants.rating": "Rating",
  "search.search.constants.model": "Model",
},
} as const satisfies ScopedLocaleResources

export const searchCatalog = createTranslationCatalog(searchResources)
