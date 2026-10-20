import { WildcardModel, WildcardWithItems, WildcardItem, type WildcardTool } from '../models/Wildcard';
import { danbooruBrowserService } from './danbooruBrowserService';
import { parsePromptRandomTokenBody, PROMPT_RANDOM_TOKEN_PATTERN } from '@conai/shared';
import { resolvePromptGroupPickCount } from './danbooruBrowser/promptGroupSyntax';
import { PromptGroupService } from './promptGroupService';

type WildcardStoredTool = WildcardTool
type WildcardResolutionTool = WildcardStoredTool | 'codex'
/** Which prompt box the text came from; `__my:group__` reads the same-named group of that kind first. */
export type WildcardPromptKind = 'positive' | 'negative'

/** Request-local metadata/item cache; never caches selections or consumes random draws. */
export class WildcardResolver {
  private readonly wildcards = new Map<string, WildcardWithItems>();
  private readonly lookedUp = new Set<string>();
  private readonly childrenById = new Map<number, WildcardWithItems[]>();

  loadNames(names: string[]): void {
    const missing = [...new Set(names)].filter(name => !this.wildcards.has(name) && !this.lookedUp.has(name));
    if (missing.length === 0) return;
    const records = WildcardModel.findForResolution(missing);
    const newRecords = records.filter(record => !this.wildcards.has(record.name));
    const itemIds = newRecords.filter(record => record.only_children !== 1).map(record => record.id);
    for (const wildcard of WildcardModel.withItems(newRecords, itemIds)) {
      this.wildcards.set(wildcard.name, wildcard);
    }
    missing.forEach(name => this.lookedUp.add(name));

    // Each result is a complete reachable subtree in SQLite's original name order.
    // Rebuild child lists from it rather than relying on cache insertion order.
    const children = new Map<number, WildcardWithItems[]>();
    for (const record of records) {
      if (record.parent_id === null) continue;
      const siblings = children.get(record.parent_id) ?? [];
      siblings.push(this.wildcards.get(record.name)!);
      children.set(record.parent_id, siblings);
    }
    for (const record of records) {
      if (record.include_children === 1 || record.only_children === 1) {
        this.childrenById.set(record.id, children.get(record.id) ?? []);
      }
    }
  }

  get(name: string): WildcardWithItems | undefined {
    return this.wildcards.get(name);
  }

  children(id: number): WildcardWithItems[] {
    return this.childrenById.get(id) ?? [];
  }
}

/**
 * Wildcard Service
 * 와일드카드 파싱 및 처리 로직
 */
export class WildcardService {
  /**
   * 텍스트에서 와일드카드를 파싱하고 랜덤 값으로 치환
   * 중첩된 와일드카드를 재귀적으로 처리하며 순환 참조를 방지함
   *
   * @param text 파싱할 텍스트
   * @param tool 사용할 도구 ('comfyui' | 'nai' | 'codex')
   * @param promptKind 긍정/부정 프롬프트 구분 (`__my:` 그룹 선택 기준)
   * @returns 파싱된 텍스트
   */
  static createResolver(): WildcardResolver {
    return new WildcardResolver();
  }

  static parseWildcards(
    text: string,
    tool: WildcardResolutionTool,
    promptKind: WildcardPromptKind = 'positive',
    resolver: WildcardResolver = this.createResolver()
  ): string {
    resolver.loadNames([...this.extractWildcardNames(text), ...this.splitChainTokens(text)]);

    // 재귀 파싱 시작
    let result = text;

    // 1. 랜덤 토큰 처리 (__tag:그룹__, __my:그룹__, __와일드카드__)
    result = this.expandRandomTokens(result, resolver, tool, promptKind);

    // 2. 체인 처리 (전역 토큰 변환)
    result = this.parseChains(result, resolver, tool);

    // 3. 와일드카드 처리 (++name++)
    result = this.parseRecursive(result, resolver, tool, new Set(), promptKind);

    return this.compactPromptSegments(result);
  }

  /**
   * `__...__` 토큰 해석
   * - `__tag:그룹|옵션__` → 단부루 태그 그룹 랜덤
   * - `__my:그룹|옵션__` → 내 프롬프트 그룹 랜덤 (긍정 칸은 긍정 그룹, 부정 칸은 부정 그룹)
   * - `__이름__` / `__이름|2__` → 같은 이름의 와일드카드가 있으면 항목을 (개수만큼 겹치지 않게) 뽑고,
   *   없거나 예전 `[1~2]` 옵션을 쓰면 단부루 그룹으로 해석
   */
  private static expandRandomTokens(
    text: string,
    resolver: WildcardResolver,
    tool: WildcardResolutionTool,
    promptKind: WildcardPromptKind
  ): string {
    resolver.loadNames(this.extractWildcardNames(text));
    return text.replace(PROMPT_RANDOM_TOKEN_PATTERN, (_match, rawBody: string) => {
      const token = parsePromptRandomTokenBody(rawBody);
      if (!token) {
        return '';
      }

      if (token.source === 'my') {
        return PromptGroupService.pickRandomPromptsByGroupName(token.name, resolvePromptGroupPickCount(token.pick), token.usage, promptKind).join(', ');
      }

      const wildcard = token.source === 'wildcard' && !token.legacy ? resolver.get(token.name) : undefined;
      if (wildcard) {
        if (!token.hasOptions) {
          return `++${token.name}++`;
        }
        // 뽑힌 항목 안의 ++이름++ / __토큰__은 이후 단계(parseRecursive)가 이어서 푼다
        const items = this.collectItemsWithChildren(wildcard, tool, resolver);
        return this.selectDistinctItemsWithWeight(items, resolvePromptGroupPickCount(token.pick)).map((item) => item.content).join(', ');
      }

      // __tag:group__ 또는 와일드카드가 아닌 예전 __group__
      return danbooruBrowserService.expandPromptGroupToken(token);
    });
  }

  /**
   * 체인 파싱 및 치환
   * 쉼표로 구분된 토큰을 분석하여 체인이 있으면 치환
   * 
   * @param text 파싱할 텍스트
   * @param resolver 요청 내 와일드카드 조회 캐시
   * @param tool 사용할 도구
   * @returns 파싱된 텍스트
   */
  private static splitChainTokens(text: string): string[] {
    const tokens: string[] = [];
    let current = '';
    const bracketStack: string[] = [];
    let isEscaped = false;

    const openToClose: Record<string, string> = {
      '(': ')',
      '[': ']',
      '{': '}'
    };
    const closingBrackets = new Set(Object.values(openToClose));

    for (const character of text) {
      if (isEscaped) {
        current += character;
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        current += character;
        isEscaped = true;
        continue;
      }

      if (character in openToClose) {
        bracketStack.push(openToClose[character]);
        current += character;
        continue;
      }

      if (closingBrackets.has(character)) {
        if (bracketStack[bracketStack.length - 1] === character) {
          bracketStack.pop();
        }
        current += character;
        continue;
      }

      if (character === ',' && bracketStack.length === 0) {
        tokens.push(current.trim());
        current = '';
        continue;
      }

      current += character;
    }

    tokens.push(current.trim());
    return tokens;
  }

  private static compactPromptSegments(text: string): string {
    return this.splitChainTokens(text)
      .map(token => token.trim())
      .filter(token => token.length > 0)
      .join(', ');
  }

  private static parseChains(
    text: string,
    resolver: WildcardResolver,
    tool: WildcardResolutionTool
  ): string {
    const tokens = this.splitChainTokens(text);
    resolver.loadNames(tokens);
    const processedTokens = tokens.map(token => {
      // 해당 이름의 체인이 있는지 확인
      const chain = resolver.get(token);

      // 체인이 아니거나 타입이 체인이 아니면 원본 반환
      if (!chain || chain.type !== 'chain') {
        return token;
      }

      // 해당 도구의 항목 수집
      const items = this.collectItemsWithChildren(chain, tool, resolver);
      if (items.length === 0) {
        return token; // 항목이 없으면 원본 유지
      }

      // 가중치 기반 랜덤 선택
      const selectedItem = this.selectRandomItemWithWeight(items);

      // 옵션에 따른 치환
      if (chain.chain_option === 'append') {
        return `${token}, ${selectedItem.content}`;
      } else {
        // replace
        return selectedItem.content;
      }
    });

    return processedTokens.join(', ');
  }

  private static resolvePreferredToolOrder(tool: WildcardResolutionTool): WildcardStoredTool[] {
    if (tool === 'codex') {
      return ['general']
    }

    if (tool === 'nai') {
      return ['nai', 'general']
    }

    if (tool === 'comfyui') {
      return ['comfyui', 'general']
    }

    return ['general']
  }

  private static collectOwnItemsForTool(wildcard: WildcardWithItems, tool: WildcardResolutionTool): WildcardItem[] {
    for (const candidateTool of this.resolvePreferredToolOrder(tool)) {
      const matchedItems = wildcard.items.filter(item => item.tool === candidateTool)
      if (matchedItems.length > 0) {
        return matchedItems
      }
    }

    return []
  }

  /**
   * 가중치를 고려한 랜덤 항목 선택
   */
  private static selectRandomItemWithWeight(items: WildcardItem[]): WildcardItem {
    if (items.length === 0) throw new Error('Items array is empty');

    const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1.0), 0);
    let random = Math.random() * totalWeight;

    for (const item of items) {
      const weight = item.weight || 1.0;
      if (random < weight) {
        return item;
      }
      random -= weight;
    }

    // 부동소수점 오차 등으로 인해 선택되지 않은 경우 마지막 항목 반환
    return items[items.length - 1];
  }

  /** 가중치를 고려해 서로 다른 항목을 최대 count개 뽑는다 (항목이 모자라면 있는 만큼). */
  private static selectDistinctItemsWithWeight(items: WildcardItem[], count: number): WildcardItem[] {
    const remaining = [...items];
    const selected: WildcardItem[] = [];
    while (selected.length < count && remaining.length > 0) {
      const item = this.selectRandomItemWithWeight(remaining);
      selected.push(item);
      remaining.splice(remaining.indexOf(item), 1);
    }
    return selected;
  }

  /**
   * 가중치 문법 파싱 - 리스트 방식
   * 예: (태그, 1.0, 1.1, 1.2) -> (태그:1.1) 중 랜덤
   *
   * @param text 파싱할 텍스트
   * @returns 파싱된 텍스트
   */
  private static parseWeightListSyntax(text: string): string {
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
   *
   * @param text 파싱할 텍스트
   * @returns 파싱된 텍스트
   */
  private static parseWeightRangeSyntax(text: string): string {
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
   * 와일드카드의 항목을 수집 (include_children 옵션 고려, 재귀적)
   * include_children이 활성화된 경우 모든 하위 항목을 재귀적으로 포함
   *
   * @param wildcard 대상 와일드카드
   * @param tool 사용할 도구
   * @param resolver 요청 내 와일드카드 조회 캐시
   * @param visited 순환 참조 방지용 (이미 방문한 와일드카드 ID)
   * @returns 항목 배열
   */
  private static collectItemsWithChildren(
    wildcard: WildcardWithItems,
    tool: WildcardResolutionTool,
    resolver: WildcardResolver,
    visited: Set<number> = new Set()
  ): WildcardItem[] {
    // 순환 참조 방지
    if (visited.has(wildcard.id)) {
      return [];
    }
    visited.add(wildcard.id);

    // 1. 자기 자신의 항목 수집 (only_children이 1이면 제외)
    // only_children: 자신은 제외하고 자식만 포함하는 그룹용 옵션
    const items = (wildcard.only_children === 1)
      ? []
      : this.collectOwnItemsForTool(wildcard, tool);

    // 2. include_children이 활성화된 경우 하위 항목 재귀적으로 수집
    // only_children이 활성화된 경우, include_children 설정과 관계없이(혹은 함께) 자식을 포함하는 것이 의도에 부합
    // 보통 only_children=1이면 include_children=1이어야 의미가 있음
    if (wildcard.include_children === 1 || wildcard.only_children === 1) {
      for (const wc of resolver.children(wildcard.id)) {
        // 자식의 include_children 설정도 고려하여 재귀 호출
        const childItems = this.collectItemsWithChildren(wc, tool, resolver, visited);
        items.push(...childItems);
      }
    }

    return items;
  }

  /**
   * 재귀적 파싱 (중첩 지원)
   *
   * @param text 파싱할 텍스트
   * @param resolver 요청 내 와일드카드 조회 캐시
   * @param tool 사용할 도구
   * @param visited 방문한 와일드카드 (순환 참조 방지)
   * @returns 파싱된 텍스트
   */
  private static parseRecursive(
    text: string,
    resolver: WildcardResolver,
    tool: WildcardResolutionTool,
    visited: Set<string>,
    promptKind: WildcardPromptKind
  ): string {
    // ++name++ 패턴 매칭 (항목 안의 __...__ 토큰은 먼저 ++name++ 또는 결과로 바꾼다)
    const pattern = /\+\+([^+]+)\+\+/g;

    const expanded = this.expandRandomTokens(text, resolver, tool, promptKind);
    resolver.loadNames(this.extractWildcardNames(expanded));
    let result = expanded.replace(pattern, (match, name) => {
      // 순환 참조 체크
      if (visited.has(name)) {
        console.warn(`Circular reference detected for wildcard: ${name}`);
        return ''; // 순환 참조 시 빈 문자열 반환 (프롬프트에 영향 없음)
      }

      // 와일드카드 조회
      const wildcard = resolver.get(name);
      if (!wildcard) {
        console.warn(`Wildcard not found: ${name}`);
        return ''; // 빈 문자열 반환
      }

      // 해당 도구의 항목 수집 (include_children 옵션 고려)
      const toolItems = this.collectItemsWithChildren(wildcard, tool, resolver);

      if (toolItems.length === 0) {
        console.warn(`No items found for wildcard '${name}' with tool '${tool}'`);
        return ''; // 빈 문자열 반환
      }

      // 랜덤 항목 선택 (가중치 적용)
      const selectedItem = this.selectRandomItemWithWeight(toolItems);

      // 방문 표시
      visited.add(name);

      // 재귀 파싱 (중첩된 와일드카드 처리)
      const recursiveResult = this.parseRecursive(selectedItem.content, resolver, tool, visited, promptKind);

      // 방문 해제 (다른 경로에서 사용 가능하도록)
      visited.delete(name);

      return recursiveResult;
    });

    // 와일드카드 치환 후 가중치 문법 파싱
    result = this.parseWeightRangeSyntax(result); // 범위 방식 먼저 (더 구체적인 패턴)
    result = this.parseWeightListSyntax(result);  // 리스트 방식

    return result;
  }

  /**
   * 텍스트에서 사용된 와일드카드 이름 추출
   *
   * @param text 분석할 텍스트
   * @returns 와일드카드 이름 배열
   */
  static extractWildcardNames(text: string): string[] {
    const pattern = /\+\+([^+]+)\+\+/g;
    const names: string[] = [];
    let match;

    while ((match = pattern.exec(text)) !== null) {
      names.push(match[1]);
    }

    // __이름__ (접두사 없는 토큰)도 와일드카드 참조로 취급
    for (const tokenMatch of text.matchAll(PROMPT_RANDOM_TOKEN_PATTERN)) {
      const token = parsePromptRandomTokenBody(tokenMatch[1]);
      if (token?.source === 'wildcard' && !token.legacy) {
        names.push(token.name);
      }
    }

    return [...new Set(names)]; // 중복 제거
  }

  /**
   * 와일드카드 유효성 검증
   * 순환 참조가 있는지 확인
   *
   * @param wildcardId 검증할 와일드카드 ID
   * @returns 순환 참조가 있으면 해당 경로, 없으면 null
   */
  static detectCircularReference(wildcardId: number): string[] | null {
    const wildcard = WildcardModel.findByIdWithItems(wildcardId);
    if (!wildcard) return null;

    // 모든 와일드카드 로드
    const allWildcards = WildcardModel.findAllWithItems();
    const wildcardMap = new Map<string, WildcardWithItems>();
    allWildcards.forEach(wc => wildcardMap.set(wc.name, wc));

    // DFS로 순환 참조 검사
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (name: string): boolean => {
      if (recursionStack.has(name)) {
        // 순환 참조 발견
        path.push(name);
        return true;
      }

      if (visited.has(name)) {
        return false; // 이미 검사한 경로
      }

      visited.add(name);
      recursionStack.add(name);
      path.push(name);

      const wc = wildcardMap.get(name);
      if (wc && wc.items) {
        for (const item of wc.items) {
          const referencedNames = this.extractWildcardNames(item.content);
          for (const refName of referencedNames) {
            if (dfs(refName)) {
              return true;
            }
          }
        }
      }

      recursionStack.delete(name);
      path.pop();
      return false;
    };

    if (dfs(wildcard.name)) {
      return path;
    }

    return null;
  }

  /**
   * 프리뷰용 여러 번 파싱 (다양한 결과 확인)
   *
   * @param text 파싱할 텍스트
   * @param tool 사용할 도구
   * @param count 생성할 결과 개수
   * @returns 파싱 결과 배열
   */
  static parseMultiple(
    text: string,
    tool: WildcardResolutionTool,
    count: number = 5,
    promptKind: WildcardPromptKind = 'positive'
  ): string[] {
    const results: string[] = [];
    const resolver = this.createResolver();
    for (let i = 0; i < count; i++) {
      results.push(this.parseWildcards(text, tool, promptKind, resolver));
    }
    return results;
  }

  /**
   * 와일드카드 통계 정보
   */
  static getStatistics(): {
    totalWildcards: number;
    itemsByTool: { general: number; comfyui: number; nai: number };
    totalItems: number;
    averageItemsPerWildcard: number;
  } {
    const wildcards = WildcardModel.findAllWithItems();

    let generalItems = 0;
    let comfyuiItems = 0;
    let naiItems = 0;

    wildcards.forEach(w => {
      w.items.forEach(item => {
        if (item.tool === 'general') generalItems++;
        else if (item.tool === 'comfyui') comfyuiItems++;
        else if (item.tool === 'nai') naiItems++;
      });
    });

    const totalItems = generalItems + comfyuiItems + naiItems;
    const averageItemsPerWildcard = wildcards.length > 0 ? totalItems / wildcards.length : 0;

    return {
      totalWildcards: wildcards.length,
      itemsByTool: { general: generalItems, comfyui: comfyuiItems, nai: naiItems },
      totalItems,
      averageItemsPerWildcard
    };
  }
}
