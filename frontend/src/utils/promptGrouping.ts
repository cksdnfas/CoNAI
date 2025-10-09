/**
 * 프롬프트 그룹화 유틸리티
 * 현재 프롬프트를 그룹별로 분류하는 로직
 */

import { parsePromptTerms } from './promptParser';
import { API_BASE_URL } from '../services/api';

export interface PromptGroup {
  id: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
}

export interface GroupedPromptTerms {
  id: number;
  group_name: string;
  terms: string[];
}

export interface GroupedPromptResult {
  groups: GroupedPromptTerms[];
  unclassified_terms: string[];
}

/**
 * 그룹 목록을 가져오는 함수
 */
export const fetchPromptGroups = async (type: 'positive' | 'negative'): Promise<PromptGroup[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/prompt-groups?type=${type}&include_hidden=false`);
    const result = await response.json();

    if (result.success) {
      // Unclassified 그룹(id: 0) 제외하고 실제 그룹들만 반환
      return result.data.filter((group: any) => group.id !== 0);
    }

    console.error('Failed to fetch prompt groups:', result.error);
    return [];
  } catch (error) {
    console.error('Error fetching prompt groups:', error);
    return [];
  }
};

/**
 * 특정 그룹의 프롬프트 목록을 가져오는 함수
 */
export const fetchGroupPrompts = async (
  groupId: number,
  type: 'positive' | 'negative'
): Promise<string[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/prompt-groups/${groupId}/prompts?type=${type}&limit=1000`);
    const result = await response.json();

    if (result.success && result.data.prompts) {
      return result.data.prompts.map((item: any) => item.prompt);
    }

    return [];
  } catch (error) {
    console.error('Error fetching group prompts:', error);
    return [];
  }
};

/**
 * 현재 프롬프트 텍스트를 그룹별로 분류하는 함수
 */
export const groupPromptTerms = async (
  promptText: string,
  type: 'positive' | 'negative'
): Promise<GroupedPromptResult> => {
  if (!promptText) {
    return { groups: [], unclassified_terms: [] };
  }

  // 1. 프롬프트를 개별 항목으로 파싱
  const terms = parsePromptTerms(promptText);

  // 2. 그룹 목록 가져오기
  const groups = await fetchPromptGroups(type);

  // 3. 각 그룹의 프롬프트 목록 가져오기
  const groupPromptMap = new Map<number, string[]>();

  for (const group of groups) {
    const groupPrompts = await fetchGroupPrompts(group.id, type);
    groupPromptMap.set(group.id, groupPrompts.map(p => p.toLowerCase()));
  }

  // 4. 각 항목을 그룹에 매칭
  const groupedTerms = new Map<number, string[]>();
  const unclassifiedTerms: string[] = [];

  for (const term of terms) {
    const normalizedTerm = term.toLowerCase();
    let matched = false;

    for (const [groupId, groupPrompts] of groupPromptMap) {
      if (groupPrompts.includes(normalizedTerm)) {
        if (!groupedTerms.has(groupId)) {
          groupedTerms.set(groupId, []);
        }
        groupedTerms.get(groupId)!.push(term);
        matched = true;
        break;
      }
    }

    if (!matched) {
      unclassifiedTerms.push(term);
    }
  }

  // 5. 결과 구성
  const result: GroupedPromptTerms[] = [];

  for (const group of groups) {
    const terms = groupedTerms.get(group.id) || [];
    if (terms.length > 0) {
      result.push({
        id: group.id,
        group_name: group.group_name,
        terms
      });
    }
  }

  // display_order로 정렬
  result.sort((a, b) => {
    const groupA = groups.find(g => g.id === a.id);
    const groupB = groups.find(g => g.id === b.id);
    return (groupA?.display_order || 0) - (groupB?.display_order || 0);
  });

  return {
    groups: result,
    unclassified_terms: unclassifiedTerms
  };
};
