/**
 * 프롬프트 그룹화 유틸리티
 * 현재 프롬프트를 그룹별로 분류하는 로직
 */

import {
  parsePromptWithLoRAs,
  cleanPromptTerm,
  refinePrimaryPrompt,
  removeLoRAWeight
} from '@comfyui-image-manager/shared';
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

// Cache for prompt groups to prevent redundant API calls
const promptGroupsCache = new Map<string, { data: PromptGroup[], timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Cached version of fetchPromptGroups
 */
const fetchPromptGroupsCached = async (type: 'positive' | 'negative'): Promise<PromptGroup[]> => {
  const cacheKey = `groups_${type}`;
  const cached = promptGroupsCache.get(cacheKey);

  // Return cached data if valid
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Fetch new data
  const groups = await fetchPromptGroups(type);

  // Update cache
  promptGroupsCache.set(cacheKey, {
    data: groups,
    timestamp: Date.now(),
  });

  return groups;
};

/**
 * 현재 프롬프트 텍스트를 그룹별로 분류하는 함수
 * Optimized with parallel fetching and caching
 */
export const groupPromptTerms = async (
  promptText: string,
  type: 'positive' | 'negative'
): Promise<GroupedPromptResult> => {
  if (!promptText) {
    return { groups: [], unclassified_terms: [] };
  }

  // 1. NAI 문법 변환 (1.5::rain:: → (rain:1.5))
  const refinedPrompt = refinePrimaryPrompt(promptText);

  // 2. LoRA와 일반 프롬프트 분리
  const { loras, terms } = parsePromptWithLoRAs(refinedPrompt);

  // 3. 그룹 목록 가져오기 (cached)
  const groups = await fetchPromptGroupsCached(type);

  // 4. 각 그룹의 프롬프트 목록 가져오기 (병렬 처리로 최적화)
  const groupPromptMap = new Map<number, string[]>();

  // Fetch all group prompts in parallel instead of sequentially
  const groupPromptPromises = groups.map(async (group) => {
    const groupPrompts = await fetchGroupPrompts(group.id, type);
    return {
      groupId: group.id,
      prompts: groupPrompts.map(p => p.toLowerCase()),
    };
  });

  // Wait for all promises to resolve
  const groupPromptResults = await Promise.all(groupPromptPromises);

  // Populate the map with results
  for (const result of groupPromptResults) {
    groupPromptMap.set(result.groupId, result.prompts);
  }

  // 5. 각 항목을 그룹에 매칭
  const groupedTerms = new Map<number, string[]>();
  const unclassifiedTerms: string[] = [];

  // 일반 프롬프트 처리
  for (const term of terms) {
    // 이미지 프롬프트를 콜렉션 형식으로 정규화
    const normalizedTerm = cleanPromptTerm(term).toLowerCase();
    let matched = false;

    for (const [groupId, groupPrompts] of groupPromptMap) {
      if (groupPrompts.includes(normalizedTerm)) {
        if (!groupedTerms.has(groupId)) {
          groupedTerms.set(groupId, []);
        }
        // 원본 term 저장 (괄호, 가중치, 언더스코어 포함)
        groupedTerms.get(groupId)!.push(term);
        matched = true;
        break;
      }
    }

    if (!matched) {
      unclassifiedTerms.push(term);
    }
  }

  // LoRA 처리 (가중치 제거 후 매칭)
  for (const lora of loras) {
    const normalizedLoRA = removeLoRAWeight(lora).toLowerCase();
    let matched = false;

    for (const [groupId, groupPrompts] of groupPromptMap) {
      if (groupPrompts.includes(normalizedLoRA)) {
        if (!groupedTerms.has(groupId)) {
          groupedTerms.set(groupId, []);
        }
        // 원본 lora 저장 (가중치 포함)
        groupedTerms.get(groupId)!.push(lora);
        matched = true;
        break;
      }
    }

    if (!matched) {
      unclassifiedTerms.push(lora);
    }
  }

  // 6. 결과 구성
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
