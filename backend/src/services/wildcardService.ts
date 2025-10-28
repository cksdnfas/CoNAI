import { WildcardModel, WildcardWithItems } from '../models/Wildcard';

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
   * @param tool 사용할 도구 ('comfyui' | 'nai')
   * @returns 파싱된 텍스트
   */
  static parseWildcards(text: string, tool: 'comfyui' | 'nai'): string {
    // 모든 와일드카드를 항목과 함께 로드
    const wildcards = WildcardModel.findAllWithItems();

    // 이름으로 빠른 조회를 위한 Map 생성
    const wildcardMap = new Map<string, WildcardWithItems>();
    wildcards.forEach(wc => wildcardMap.set(wc.name, wc));

    // 재귀 파싱 시작
    return this.parseRecursive(text, wildcardMap, tool, new Set());
  }

  /**
   * 재귀적 파싱 (중첩 지원)
   *
   * @param text 파싱할 텍스트
   * @param wildcardMap 와일드카드 맵
   * @param tool 사용할 도구
   * @param visited 방문한 와일드카드 (순환 참조 방지)
   * @returns 파싱된 텍스트
   */
  private static parseRecursive(
    text: string,
    wildcardMap: Map<string, WildcardWithItems>,
    tool: 'comfyui' | 'nai',
    visited: Set<string>
  ): string {
    // ++name++ 패턴 매칭 (ComfyUI의 __name__과 구분)
    const pattern = /\+\+([^+]+)\+\+/g;

    return text.replace(pattern, (match, name) => {
      // 순환 참조 체크
      if (visited.has(name)) {
        console.warn(`Circular reference detected for wildcard: ${name}`);
        return match; // 원본 그대로 반환
      }

      // 와일드카드 조회
      const wildcard = wildcardMap.get(name);
      if (!wildcard || !wildcard.items || wildcard.items.length === 0) {
        console.warn(`Wildcard not found or empty: ${name}`);
        return match; // 원본 그대로 반환
      }

      // 해당 도구의 항목만 필터링
      const toolItems = wildcard.items.filter(item => item.tool === tool);

      if (toolItems.length === 0) {
        console.warn(`No items found for wildcard '${name}' with tool '${tool}'`);
        return match; // 원본 그대로 반환
      }

      // 랜덤 항목 선택
      const randomIndex = Math.floor(Math.random() * toolItems.length);
      const selectedItem = toolItems[randomIndex];

      // 방문 표시
      visited.add(name);

      // 재귀 파싱 (중첩된 와일드카드 처리)
      const result = this.parseRecursive(selectedItem.content, wildcardMap, tool, visited);

      // 방문 해제 (다른 경로에서 사용 가능하도록)
      visited.delete(name);

      return result;
    });
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
    tool: 'comfyui' | 'nai',
    count: number = 5
  ): string[] {
    const results: string[] = [];
    for (let i = 0; i < count; i++) {
      results.push(this.parseWildcards(text, tool));
    }
    return results;
  }

  /**
   * 와일드카드 통계 정보
   */
  static getStatistics(): {
    totalWildcards: number;
    itemsByTool: { comfyui: number; nai: number };
    totalItems: number;
    averageItemsPerWildcard: number;
  } {
    const wildcards = WildcardModel.findAllWithItems();

    let comfyuiItems = 0;
    let naiItems = 0;

    wildcards.forEach(w => {
      w.items.forEach(item => {
        if (item.tool === 'comfyui') comfyuiItems++;
        else if (item.tool === 'nai') naiItems++;
      });
    });

    const totalItems = comfyuiItems + naiItems;
    const averageItemsPerWildcard = wildcards.length > 0 ? totalItems / wildcards.length : 0;

    return {
      totalWildcards: wildcards.length,
      itemsByTool: { comfyui: comfyuiItems, nai: naiItems },
      totalItems,
      averageItemsPerWildcard
    };
  }
}
