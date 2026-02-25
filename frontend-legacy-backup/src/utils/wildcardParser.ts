import { wildcardApi, type WildcardWithItems } from '../services/api/wildcardApi';
import { cleanPrompt } from './promptCleaner';

/**
 * 클라이언트 사이드 와일드카드 파서
 * ++name++ 패턴을 파싱하여 랜덤 값으로 치환
 */

// 와일드카드 캐시 (성능 최적화)
let wildcardCache: WildcardWithItems[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 60000; // 1분

/**
 * 와일드카드 목록 로드 및 캐싱
 */
async function loadWildcards(): Promise<WildcardWithItems[]> {
  const now = Date.now();

  // 캐시가 유효하면 캐시 사용
  if (wildcardCache && (now - cacheTimestamp) < CACHE_TTL) {
    return wildcardCache;
  }

  try {
    const response = await wildcardApi.getAllWildcards(true);
    wildcardCache = response.data || [];
    cacheTimestamp = now;
    return wildcardCache;
  } catch (error) {
    console.error('Failed to load wildcards:', error);
    return [];
  }
}

/**
 * 캐시 무효화
 */
export function invalidateWildcardCache(): void {
  wildcardCache = null;
  cacheTimestamp = 0;
}

/**
 * 가중치 문법 파싱 - 리스트 방식
 * 예: (태그, 1.0, 1.1, 1.2) -> (태그:1.1) 중 랜덤
 */
function parseWeightListSyntax(text: string): string {
  const pattern = /\(([^,)]+),\s*([\d.,\s-]+)\)/g;

  return text.replace(pattern, (match, tag, weights) => {
    // 가중치 값들을 배열로 분리
    const weightValues = weights.split(',')
      .map((w: string) => w.trim())
      .filter((w: string) => w.length > 0 && !isNaN(parseFloat(w)));

    if (weightValues.length === 0) {
      // 유효한 가중치가 없으면 원본 반환
      return match;
    }

    // 랜덤 가중치 선택
    const randomWeight = weightValues[Math.floor(Math.random() * weightValues.length)];
    return `(${tag.trim()}:${randomWeight})`;
  });
}

/**
 * 가중치 문법 파싱 - 범위 방식
 * 예: (태그, -1.0~1.0, 0.1) -> (태그:-0.3) 범위 내 랜덤
 */
function parseWeightRangeSyntax(text: string): string {
  const pattern = /\(([^,)]+),\s*([-\d.]+)~([-\d.]+),\s*([\d.]+)\)/g;

  return text.replace(pattern, (match, tag, minStr, maxStr, stepStr) => {
    const min = parseFloat(minStr);
    const max = parseFloat(maxStr);
    const step = parseFloat(stepStr);

    // 유효성 검사
    if (isNaN(min) || isNaN(max) || isNaN(step) || step <= 0 || min >= max) {
      console.warn(`[Weight] Invalid range syntax: ${match}`);
      return match;
    }

    // 범위 내 가능한 값 생성
    const values: number[] = [];
    for (let v = min; v <= max; v = parseFloat((v + step).toFixed(10))) {
      values.push(parseFloat(v.toFixed(2))); // 소수점 2자리로 반올림
    }

    if (values.length === 0) {
      return match;
    }

    // 랜덤 값 선택
    const randomValue = values[Math.floor(Math.random() * values.length)];
    return `(${tag.trim()}:${randomValue})`;
  });
}

/**
 * 와일드카드 자체의 가중치 제거
 * 예: (++꽃++:1.2) -> ++꽃++
 */
function cleanupWildcardWeights(text: string): string {
  const pattern = /\((\+\+[^+]+\+\+):[\d.]+\)/g;
  return text.replace(pattern, '$1');
}

/**
 * 파싱 결과 정보
 */
export interface ParseResult {
  text: string;
  emptyWildcards: string[]; // 항목이 비어있는 와일드카드 목록
}

/**
 * 존재하지 않는 와일드카드 제거 (빈 문자열로 치환)
 */
function removeInvalidWildcards(
  text: string,
  wildcardMap: Map<string, WildcardWithItems>
): string {
  const pattern = /\+\+([^+]+)\+\+/g;

  return text.replace(pattern, (match, name) => {
    const wildcard = wildcardMap.get(name);
    // 와일드카드가 존재하지 않거나 항목이 없으면 빈 문자열로 치환
    if (!wildcard || !wildcard.items || wildcard.items.length === 0) {
      console.warn(`[Wildcard] Removing invalid wildcard: ${name}`);
      return ''; // 빈 문자열로 치환
    }
    return match;
  });
}

/**
 * 와일드카드의 모든 하위 항목(자식 포함)을 수집
 */
function collectAllItems(
  wildcard: WildcardWithItems,
  wildcardMap: Map<string, WildcardWithItems>,
  tool: 'comfyui' | 'nai'
): Array<{ content: string; tool: string }> {
  const items: Array<{ content: string; tool: string }> = [];

  // 현재 와일드카드의 항목 추가
  if (wildcard.items) {
    items.push(...wildcard.items.filter(item => item.tool === tool));
  }

  // include_children이 1이면 하위 와일드카드의 항목도 수집
  if ((wildcard as any).include_children === 1) {
    // 모든 와일드카드를 순회하며 parent_id가 현재 와일드카드 id인 것을 찾음
    wildcardMap.forEach((child) => {
      if (child.parent_id === wildcard.id) {
        // 재귀적으로 하위 항목 수집
        items.push(...collectAllItems(child, wildcardMap, tool));
      }
    });
  }

  return items;
}

/**
 * 재귀적 파싱 (중첩 지원)
 */
function parseRecursive(
  text: string,
  wildcardMap: Map<string, WildcardWithItems>,
  tool: 'comfyui' | 'nai',
  visited: Set<string>,
  emptyWildcards: Set<string>
): string {
  // ++name++ 패턴 매칭
  const pattern = /\+\+([^+]+)\+\+/g;

  let result = text.replace(pattern, (match, name) => {
    // 순환 참조 체크
    if (visited.has(name)) {
      console.warn(`[Wildcard] Circular reference detected: ${name}`);
      return '';
    }

    // 와일드카드 조회
    const wildcard = wildcardMap.get(name);
    if (!wildcard) {
      console.warn(`[Wildcard] Not found: ${name}`);
      emptyWildcards.add(name);
      return ''; // 빈 문자열로 치환
    }

    // 해당 도구의 항목 수집 (include_children 고려)
    const toolItems = collectAllItems(wildcard, wildcardMap, tool);

    if (toolItems.length === 0) {
      console.warn(`[Wildcard] No items for '${name}' with tool '${tool}'`);
      emptyWildcards.add(name);
      return ''; // 빈 문자열로 치환
    }

    // 랜덤 항목 선택
    const randomIndex = Math.floor(Math.random() * toolItems.length);
    const selectedItem = toolItems[randomIndex];

    // 방문 표시
    visited.add(name);

    // 재귀 파싱 (중첩 와일드카드 처리)
    const recursiveResult = parseRecursive(selectedItem.content, wildcardMap, tool, visited, emptyWildcards);

    // 방문 해제
    visited.delete(name);

    return recursiveResult;
  });

  // 와일드카드 치환 후 가중치 문법 파싱
  result = parseWeightRangeSyntax(result); // 범위 방식 먼저 (더 구체적인 패턴)
  result = parseWeightListSyntax(result);  // 리스트 방식

  return result;
}

/**
 * 텍스트에서 와일드카드 파싱
 * @param text 파싱할 텍스트
 * @param tool 사용할 도구 ('comfyui' | 'nai')
 * @returns 파싱 결과 (파싱된 텍스트 + 빈 와일드카드 목록)
 */
export async function parseWildcards(
  text: string,
  tool: 'comfyui' | 'nai'
): Promise<ParseResult> {
  if (!text) {
    return { text, emptyWildcards: [] };
  }

  // 와일드카드 로드
  const wildcards = await loadWildcards();

  // 이름으로 빠른 조회를 위한 Map 생성
  const wildcardMap = new Map<string, WildcardWithItems>();
  wildcards.forEach(wc => wildcardMap.set(wc.name, wc));

  // 전처리: 와일드카드 자체의 가중치 제거
  let processedText = cleanupWildcardWeights(text);

  // 빈 와일드카드 추적
  const emptyWildcards = new Set<string>();

  // 재귀 파싱 시작 (++name++ 패턴이 있을 때만)
  let result = processedText;
  if (processedText.includes('++')) {
    result = parseRecursive(processedText, wildcardMap, tool, new Set(), emptyWildcards);
  } else {
    // 와일드카드가 없어도 가중치 문법은 파싱
    result = parseWeightRangeSyntax(processedText);
    result = parseWeightListSyntax(result);
  }

  // 여러 공백을 하나로 정리 및 앞뒤 공백 제거
  result = result.replace(/\s+/g, ' ').trim();

  // 파싱되었으면 로그 출력
  if (result !== text) {
    console.log(`[Wildcard] Parsed (${tool}):`, {
      original: text.substring(0, 80),
      parsed: result.substring(0, 80),
      emptyWildcards: Array.from(emptyWildcards)
    });
  }

  return {
    text: result,
    emptyWildcards: Array.from(emptyWildcards)
  };
}

/**
 * 객체 파싱 결과
 */
export interface ObjectParseResult {
  data: any;
  emptyWildcards: string[];
}

/**
 * 객체의 모든 문자열 필드를 재귀적으로 파싱
 * @param obj 파싱할 객체
 * @param tool 사용할 도구
 * @returns 파싱된 객체 + 빈 와일드카드 목록
 */
export async function parseObjectWildcards(
  obj: any,
  tool: 'comfyui' | 'nai'
): Promise<ObjectParseResult> {
  const emptyWildcardsSet = new Set<string>();

  async function parseRecursiveObject(value: any): Promise<any> {
    if (typeof value === 'string') {
      const result = await parseWildcards(value, tool);
      result.emptyWildcards.forEach(w => emptyWildcardsSet.add(w));
      // 프롬프트 전처리: 빈 문자열과 중복 쉼표 제거
      return cleanPrompt(result.text);
    }

    if (Array.isArray(value)) {
      return Promise.all(value.map(item => parseRecursiveObject(item)));
    }

    if (value && typeof value === 'object') {
      const result: any = {};
      for (const key in value) {
        result[key] = await parseRecursiveObject(value[key]);
      }
      return result;
    }

    return value;
  }

  const data = await parseRecursiveObject(obj);

  return {
    data,
    emptyWildcards: Array.from(emptyWildcardsSet)
  };
}

/**
 * 텍스트에서 사용된 와일드카드 이름 추출
 */
export function extractWildcardNames(text: string): string[] {
  const pattern = /\+\+([^+]+)\+\+/g;
  const names: string[] = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    names.push(match[1]);
  }

  return [...new Set(names)];
}
