/**
 * 프롬프트 전처리 유틸리티
 *
 * API 전송 전에 프롬프트를 정리합니다:
 * - 빈 문자열 제거
 * - 중복되는 쉼표 제거
 * - 앞뒤 공백 및 쉼표 제거
 */

/**
 * 프롬프트 문자열을 정리합니다
 * @param prompt 원본 프롬프트
 * @returns 정리된 프롬프트
 *
 * @example
 * cleanPrompt("프롬1, , 프롬3, 프롬4, , , ,프롬6,")
 * // returns "프롬1, 프롬3, 프롬4, 프롬6"
 */
export function cleanPrompt(prompt: string | undefined | null): string {
  if (!prompt) {
    return '';
  }

  // 1. 쉼표로 분리
  const parts = prompt.split(',');

  // 2. 각 항목의 앞뒤 공백 제거 및 빈 문자열 필터링
  const cleanedParts = parts
    .map(part => part.trim())
    .filter(part => part.length > 0);

  // 3. 쉼표로 다시 결합
  return cleanedParts.join(', ');
}

/**
 * 프롬프트가 비어있는지 확인합니다
 * @param prompt 확인할 프롬프트
 * @returns 비어있으면 true
 */
export function isPromptEmpty(prompt: string | undefined | null): boolean {
  const cleaned = cleanPrompt(prompt);
  return cleaned.length === 0;
}

/**
 * 여러 프롬프트를 정리합니다
 * @param prompts 프롬프트 객체 (예: { positive: "...", negative: "..." })
 * @returns 정리된 프롬프트 객체
 */
export function cleanPrompts<T extends Record<string, string | undefined | null>>(
  prompts: T
): T {
  const result = { ...prompts } as T;

  for (const key in result) {
    if (typeof result[key] === 'string') {
      result[key] = cleanPrompt(result[key] as string) as T[Extract<keyof T, string>];
    }
  }

  return result;
}
