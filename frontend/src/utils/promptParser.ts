/**
 * 프롬프트 파싱 유틸리티 (프론트엔드용)
 * 가중치 제거, 프롬프트 정리, 항목 분리 등을 담당
 */

export interface ParsedPrompt {
  original: string;
  cleaned: string;
  terms: string[];
}

/**
 * 프롬프트에서 가중치를 제거하고 정리하는 함수
 * (프롬프트:1.2) -> 프롬프트
 * (프롬프트:0.5) -> 프롬프트
 */
export const removeWeights = (prompt: string): string => {
  if (!prompt) return '';

  // 가중치 패턴: (텍스트:숫자) 형태를 찾아서 텍스트만 추출
  return prompt.replace(/\(([^:)]+):[+-]?[\d.]+\)/g, '$1');
};

/**
 * 프롬프트를 쉼표로 분리하고 각 항목을 정리하는 함수
 */
export const parsePromptTerms = (prompt: string): string[] => {
  if (!prompt) return [];

  return prompt
    .split(',')
    .map(term => term.trim())
    .filter(term => term.length > 0)
    .map(term => removeWeights(term));
};

/**
 * 전체 프롬프트를 파싱하는 메인 함수
 */
export const parsePrompt = (prompt: string): ParsedPrompt => {
  const cleaned = removeWeights(prompt);
  const terms = parsePromptTerms(cleaned);

  return {
    original: prompt,
    cleaned,
    terms
  };
};

/**
 * 검색용 프롬프트 정리 함수
 */
export const normalizeSearchTerm = (searchTerm: string): string => {
  return removeWeights(searchTerm.trim());
};