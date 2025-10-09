/**
 * 프롬프트 파싱 유틸리티
 * 가중치 제거, 프롬프트 정리, 동의어 처리 등을 담당
 */

export interface ParsedPrompt {
  original: string;
  cleaned: string;
  terms: string[];
}

/**
 * 프롬프트에서 가중치를 제거하고 정리하는 함수
 * (대한민국:1.2) -> 대한민국
 * (대한민국:0.5) -> 대한민국
 * 하루노 사쿠라(나루토) -> 하루노 사쿠라(나루토) (변화 없음)
 */
export const removeWeights = (prompt: string): string => {
  if (!prompt) return '';

  // 가중치 패턴: (텍스트:숫자) 형태를 찾아서 (텍스트)로 변경
  // 단, 가중치가 아닌 일반 괄호는 그대로 유지
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
 * 검색 시에도 동일한 기준으로 가중치를 제거
 */
export const normalizeSearchTerm = (searchTerm: string): string => {
  return removeWeights(searchTerm.trim());
};

/**
 * 두 프롬프트가 동일한지 비교하는 함수
 * 가중치를 제거한 후 비교
 */
export const comparePrompts = (prompt1: string, prompt2: string): boolean => {
  const normalized1 = normalizeSearchTerm(prompt1);
  const normalized2 = normalizeSearchTerm(prompt2);
  return normalized1.toLowerCase() === normalized2.toLowerCase();
};

/**
 * 프롬프트 배열에서 중복을 제거하는 함수
 */
export const deduplicatePrompts = (prompts: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const prompt of prompts) {
    const normalized = normalizeSearchTerm(prompt).toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(removeWeights(prompt));
    }
  }

  return result;
};