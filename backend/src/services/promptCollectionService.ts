import { PromptCollectionModel } from '../models/PromptCollection';
import { PromptGroupModel } from '../models/PromptGroup';
import { SynonymService } from './synonymService';
import { PromptGroupService } from './promptGroupService';
import {
  parsePromptTerms,
  normalizeSearchTerm,
  PromptSearchResult,
  PromptStatistics,
  isLoRAModel,
  cleanPromptTerm,
  parsePromptWithLoRAs,
  removeLoRAWeight
} from '@comfyui-image-manager/shared';

export class PromptCollectionService {
  /**
   * Invalid prompt values that should not be collected
   */
  private static readonly INVALID_PROMPTS = [
    'No prompt information available',
    'Metadata extraction failed',
    'Unknown',
    'Unknown AI Model',
    'No prompt',
    ''
  ];

  /**
   * Check if prompt is valid for collection
   */
  private static isValidPrompt(prompt: string | null | undefined): boolean {
    if (!prompt || typeof prompt !== 'string') {
      return false;
    }

    const trimmed = prompt.trim();

    // Check against invalid prompts
    if (this.INVALID_PROMPTS.includes(trimmed)) {
      return false;
    }

    // Check if it's too short (less than 2 characters)
    if (trimmed.length < 2) {
      return false;
    }

    return true;
  }

  /**
   * Ensure LoRA groups exist for both positive and negative prompts
   * Creates them if they don't exist
   * @returns Object with positiveGroupId and negativeGroupId
   */
  private static async ensureLoRAGroup(): Promise<{
    positiveGroupId: number;
    negativeGroupId: number;
  }> {
    let positiveGroupId: number;
    let negativeGroupId: number;

    // Check/create positive LoRA group
    let positiveGroup = await PromptGroupModel.findByName('LoRA', 'positive');
    if (!positiveGroup) {
      console.log('📁 Creating LoRA group for positive prompts...');
      positiveGroupId = await PromptGroupModel.create(
        { group_name: 'LoRA', display_order: 999, is_visible: true },
        'positive'
      );
    } else {
      positiveGroupId = positiveGroup.id;
    }

    // Check/create negative LoRA group
    let negativeGroup = await PromptGroupModel.findByName('LoRA', 'negative');
    if (!negativeGroup) {
      console.log('📁 Creating LoRA group for negative prompts...');
      negativeGroupId = await PromptGroupModel.create(
        { group_name: 'LoRA', display_order: 999, is_visible: true },
        'negative'
      );
    } else {
      negativeGroupId = negativeGroup.id;
    }

    return { positiveGroupId, negativeGroupId };
  }

  /**
   * 이미지에서 프롬프트를 수집하여 데이터베이스에 저장
   * LoRA 모델은 자동으로 "LoRA" 그룹에 할당 (가중치 제거 후 저장)
   * 일반 단어는 괄호, 가중치, 언더스코어 제거 후 저장
   */
  static async collectFromImage(prompt: string | null, negativePrompt: string | null): Promise<void> {
    try {
      // LoRA 그룹 ID 확보
      const loraGroups = await this.ensureLoRAGroup();

      // 포지티브 프롬프트 수집 (유효성 검사 추가)
      if (this.isValidPrompt(prompt)) {
        // LoRA와 일반 단어 분리
        const { loras, terms } = parsePromptWithLoRAs(prompt!);

        // LoRA 처리 (가중치 제거 후 저장)
        for (const lora of loras) {
          try {
            const cleanedLoRA = removeLoRAWeight(lora);  // 가중치 제거
            console.log(`🎨 LoRA model detected: ${lora} → ${cleanedLoRA}`);
            await PromptCollectionModel.addOrIncrement(cleanedLoRA, loraGroups.positiveGroupId);
          } catch (loraError) {
            console.error(`❌ Failed to collect LoRA "${lora}":`, loraError);
            // 개별 LoRA 실패는 전체 실패로 이어지지 않음
          }
        }

        // 일반 단어 처리
        for (const term of terms) {
          const trimmed = term.trim();
          if (!trimmed || trimmed.length < 2) continue;

          try {
            const cleaned = cleanPromptTerm(trimmed);
            if (cleaned && cleaned.length >= 2) {
              await PromptCollectionModel.addOrIncrement(cleaned);
            }
          } catch (termError) {
            console.error(`❌ Failed to collect term "${trimmed}":`, termError);
            // 개별 항목 실패는 전체 실패로 이어지지 않음
          }
        }
      } else if (prompt) {
        console.log(`⚠️ Skipping invalid prompt: "${prompt}"`);
      }

      // 네거티브 프롬프트 수집 (동일 로직)
      if (this.isValidPrompt(negativePrompt)) {
        // LoRA와 일반 단어 분리
        const { loras, terms } = parsePromptWithLoRAs(negativePrompt!);

        // LoRA 처리 (가중치 제거 후 저장)
        for (const lora of loras) {
          try {
            const cleanedLoRA = removeLoRAWeight(lora);  // 가중치 제거
            console.log(`🎨 LoRA model detected (negative): ${lora} → ${cleanedLoRA}`);
            await PromptCollectionModel.addOrIncrementNegative(cleanedLoRA, loraGroups.negativeGroupId);
          } catch (loraError) {
            console.error(`❌ Failed to collect negative LoRA "${lora}":`, loraError);
            // 개별 LoRA 실패는 전체 실패로 이어지지 않음
          }
        }

        // 일반 단어 처리
        for (const term of terms) {
          const trimmed = term.trim();
          if (!trimmed || trimmed.length < 2) continue;

          try {
            const cleaned = cleanPromptTerm(trimmed);
            if (cleaned && cleaned.length >= 2) {
              await PromptCollectionModel.addOrIncrementNegative(cleaned);
            }
          } catch (termError) {
            console.error(`❌ Failed to collect negative term "${trimmed}":`, termError);
            // 개별 항목 실패는 전체 실패로 이어지지 않음
          }
        }
      } else if (negativePrompt) {
        console.log(`⚠️ Skipping invalid negative prompt: "${negativePrompt}"`);
      }
    } catch (error) {
      console.error('Error collecting prompts from image:', error);
      // STEP 3 요구사항: 오류 발생 시 throw하여 prompt_collection 등록 방지
      throw error;
    }
  }

  /**
   * 프롬프트 검색 (가중치 무시)
   */
  static async searchPrompts(
    query: string,
    type: 'positive' | 'negative' | 'both' = 'both',
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ prompts: PromptSearchResult[], total: number }> {
    try {
      const normalizedQuery = normalizeSearchTerm(query);

      if (type === 'both') {
        // 포지티브와 네거티브 모두 검색
        const [positiveResult, negativeResult] = await Promise.all([
          PromptCollectionModel.searchPrompts(normalizedQuery, page, limit, sortBy, sortOrder),
          PromptCollectionModel.searchNegativePrompts(normalizedQuery, page, limit, sortBy, sortOrder)
        ]);

        // 결과 합치기 및 정렬
        const allPrompts = [...positiveResult.prompts, ...negativeResult.prompts];
        allPrompts.sort((a, b) => {
          if (sortBy === 'usage_count') {
            return sortOrder === 'DESC' ? b.usage_count - a.usage_count : a.usage_count - b.usage_count;
          } else if (sortBy === 'prompt') {
            return sortOrder === 'DESC'
              ? b.prompt.localeCompare(a.prompt)
              : a.prompt.localeCompare(b.prompt);
          }
          return 0;
        });

        // 페이지네이션 적용
        const offset = (page - 1) * limit;
        const paginatedPrompts = allPrompts.slice(offset, offset + limit);

        return {
          prompts: paginatedPrompts,
          total: positiveResult.total + negativeResult.total
        };
      } else if (type === 'positive') {
        return await PromptCollectionModel.searchPrompts(normalizedQuery, page, limit, sortBy, sortOrder);
      } else {
        return await PromptCollectionModel.searchNegativePrompts(normalizedQuery, page, limit, sortBy, sortOrder);
      }
    } catch (error) {
      console.error('Error searching prompts:', error);
      throw error;
    }
  }

  /**
   * 동의어 그룹에서 검색 (가중치 제거 후 검색)
   */
  static async searchInSynonymGroup(
    searchTerm: string,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptSearchResult | null> {
    try {
      const result = await SynonymService.findInSynonymGroup(searchTerm, type);

      if (!result) {
        return null;
      }

      return {
        id: result.id,
        prompt: result.prompt,
        usage_count: result.usage_count,
        group_id: result.group_id,
        synonyms: result.synonyms ? JSON.parse(result.synonyms) : [],
        type
      };
    } catch (error) {
      console.error('Error searching in synonym group:', error);
      throw error;
    }
  }

  /**
   * 프롬프트 통계 조회
   */
  static async getStatistics(): Promise<PromptStatistics> {
    try {
      const [mostUsedPrompts] = await Promise.all([
        PromptCollectionModel.getMostUsedPrompts(10)
      ]);

      // 총 개수 조회
      const totalStats = await new Promise<{total_prompts: number, total_negative_prompts: number}>((resolve, reject) => {
        Promise.all([
          new Promise<number>((res, rej) => {
            const { db } = require('../database/init');
            db.get('SELECT COUNT(*) as count FROM prompt_collection', (err: any, row: any) => {
              if (err) rej(err);
              else res(row.count);
            });
          }),
          new Promise<number>((res, rej) => {
            const { db } = require('../database/init');
            db.get('SELECT COUNT(*) as count FROM negative_prompt_collection', (err: any, row: any) => {
              if (err) rej(err);
              else res(row.count);
            });
          })
        ]).then(([positive, negative]) => {
          resolve({
            total_prompts: positive,
            total_negative_prompts: negative
          });
        }).catch(reject);
      });

      // 최근 추가된 프롬프트 조회
      const recentPrompts = await this.searchPrompts('', 'both', 1, 10, 'created_at', 'DESC');

      return {
        total_prompts: totalStats.total_prompts,
        total_negative_prompts: totalStats.total_negative_prompts,
        most_used_prompts: mostUsedPrompts,
        recent_prompts: recentPrompts.prompts
      };
    } catch (error) {
      console.error('Error getting statistics:', error);
      throw error;
    }
  }

  /**
   * 동의어 설정 (기존 동의어 데이터 병합 포함)
   */
  static async setSynonyms(
    mainPrompt: string,
    synonyms: string[],
    type: 'positive' | 'negative' = 'positive'
  ): Promise<{ success: boolean; mergedCount: number; mainPromptId: number }> {
    try {
      return await SynonymService.setSynonymsAndMerge(mainPrompt, synonyms, type);
    } catch (error) {
      console.error('Error setting synonyms:', error);
      throw error;
    }
  }

  /**
   * 동의어 제거
   */
  static async removeSynonym(
    mainPromptId: number,
    synonymToRemove: string,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<boolean> {
    try {
      return await SynonymService.removeSynonym(mainPromptId, synonymToRemove, type);
    } catch (error) {
      console.error('Error removing synonym:', error);
      throw error;
    }
  }

  /**
   * 그룹 프롬프트 조회
   */
  static async getGroupPrompts(
    groupId: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptSearchResult[]> {
    try {
      const prompts = await SynonymService.getGroupPrompts(groupId, type);

      return prompts.map(prompt => ({
        id: prompt.id,
        prompt: prompt.prompt,
        usage_count: prompt.usage_count,
        group_id: prompt.group_id,
        synonyms: prompt.synonyms ? JSON.parse(prompt.synonyms) : [],
        type
      }));
    } catch (error) {
      console.error('Error getting group prompts:', error);
      throw error;
    }
  }

  /**
   * 그룹 ID 설정 (동의어와 별개 기능)
   */
  static async setGroupId(
    promptId: number,
    groupId: number | null,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<boolean> {
    try {
      return await PromptCollectionModel.setGroupId(promptId, groupId, type);
    } catch (error) {
      console.error('Error setting group ID:', error);
      throw error;
    }
  }

  /**
   * 프롬프트 삭제
   */
  static async deletePrompt(
    id: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<boolean> {
    try {
      return await PromptCollectionModel.delete(id, type);
    } catch (error) {
      console.error('Error deleting prompt:', error);
      throw error;
    }
  }

  /**
   * 이미지에서 프롬프트를 제거하여 사용 횟수 감소
   */
  static async removeFromImage(prompt: string | null, negativePrompt: string | null): Promise<void> {
    try {
      // 포지티브 프롬프트 감산
      if (prompt) {
        const terms = parsePromptTerms(prompt);
        for (const term of terms) {
          if (term.trim()) {
            await PromptCollectionModel.decrementUsage(term.trim(), 'positive');
          }
        }
      }

      // 네거티브 프롬프트 감산
      if (negativePrompt) {
        const terms = parsePromptTerms(negativePrompt);
        for (const term of terms) {
          if (term.trim()) {
            await PromptCollectionModel.decrementUsage(term.trim(), 'negative');
          }
        }
      }
    } catch (error) {
      console.error('Error removing prompts from image:', error);
      throw error;
    }
  }

  /**
   * 사용 횟수별 상위 프롬프트 조회
   */
  static async getTopPrompts(
    limit: number = 20,
    type: 'positive' | 'negative' | 'both' = 'both'
  ): Promise<PromptSearchResult[]> {
    try {
      if (type === 'positive') {
        return await PromptCollectionModel.getMostUsedPrompts(limit);
      } else if (type === 'negative') {
        const result = await PromptCollectionModel.searchNegativePrompts('', 1, limit, 'usage_count', 'DESC');
        return result.prompts;
      } else {
        // both
        const [positive, negative] = await Promise.all([
          PromptCollectionModel.getMostUsedPrompts(limit),
          PromptCollectionModel.searchNegativePrompts('', 1, limit, 'usage_count', 'DESC')
        ]);

        const combined = [...positive, ...negative.prompts];
        combined.sort((a, b) => b.usage_count - a.usage_count);

        return combined.slice(0, limit);
      }
    } catch (error) {
      console.error('Error getting top prompts:', error);
      throw error;
    }
  }

  /**
   * 그룹 정보를 포함한 프롬프트 검색 (향상된 버전)
   */
  static async searchPromptsWithGroups(
    query: string,
    type: 'positive' | 'negative' | 'both' = 'both',
    page: number = 1,
    limit: number = 20,
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    groupId?: number | null
  ): Promise<{ prompts: any[], total: number, group_info?: any }> {
    try {
      let result;
      let groupInfo = null;

      // 특정 그룹 내에서 검색
      if (groupId !== undefined) {
        result = await PromptGroupService.getPromptsInGroup(groupId, type as 'positive' | 'negative', page, limit);

        if (groupId !== null) {
          groupInfo = await PromptGroupService.getGroupById(groupId, type as 'positive' | 'negative');
        } else {
          groupInfo = { id: 0, group_name: 'Unclassified' };
        }

        return {
          prompts: result.prompts,
          total: result.total,
          group_info: groupInfo
        };
      }

      // 일반 검색 (기존 로직)
      result = await this.searchPrompts(query, type, page, limit, sortBy, sortOrder);

      // 결과에 그룹 정보 추가
      const enrichedPrompts = await Promise.all(
        result.prompts.map(async (prompt) => {
          const groupInfo = await PromptGroupService.getGroupById(
            prompt.group_id,
            prompt.type
          );

          return {
            ...prompt,
            group_info: groupInfo
          };
        })
      );

      return {
        prompts: enrichedPrompts,
        total: result.total
      };
    } catch (error) {
      console.error('Error searching prompts with groups:', error);
      throw error;
    }
  }

  /**
   * 프롬프트를 특정 그룹에 할당
   */
  static async assignPromptToGroup(
    promptId: number,
    groupId: number | null,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<boolean> {
    try {
      return await PromptCollectionModel.setGroupId(promptId, groupId, type);
    } catch (error) {
      console.error('Error assigning prompt to group:', error);
      throw error;
    }
  }

  /**
   * 그룹별 프롬프트 통계 조회
   */
  static async getGroupStatistics(type: 'positive' | 'negative' = 'positive'): Promise<any[]> {
    try {
      return await PromptGroupService.getAllGroups(false, type);
    } catch (error) {
      console.error('Error getting group statistics:', error);
      throw error;
    }
  }

  /**
   * 프롬프트 대량 할당
   * @param prompts 프롬프트 텍스트 배열
   * @param groupId 할당할 그룹 ID (null이면 미할당)
   * @param type 프롬프트 타입
   * @returns 생성된 개수, 업데이트된 개수, 실패한 프롬프트 목록
   */
  static async batchAssignPromptsToGroup(
    prompts: string[],
    groupId: number | null,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<{ created: number; updated: number; failed: string[] }> {
    try {
      let created = 0;
      let updated = 0;
      const failed: string[] = [];

      const addMethod = type === 'positive'
        ? PromptCollectionModel.addOrIncrement.bind(PromptCollectionModel)
        : PromptCollectionModel.addOrIncrementNegative.bind(PromptCollectionModel);

      for (const promptText of prompts) {
        const trimmedPrompt = promptText.trim();
        if (!trimmedPrompt) continue;

        try {
          // DB에서 해당 프롬프트 검색
          const tableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';
          const { db } = require('../database/init');
          const existing = db.prepare(`SELECT id FROM ${tableName} WHERE prompt = ?`).get(trimmedPrompt) as any;

          if (existing) {
            // 이미 존재하면 그룹 ID만 업데이트
            const success = await PromptCollectionModel.setGroupId(existing.id, groupId, type);
            if (success) {
              updated++;
            } else {
              failed.push(trimmedPrompt);
            }
          } else {
            // 존재하지 않으면 새로 생성하고 그룹 할당
            await addMethod(trimmedPrompt, groupId || undefined);
            created++;
          }
        } catch (error) {
          console.error(`Error assigning prompt "${trimmedPrompt}":`, error);
          failed.push(trimmedPrompt);
        }
      }

      return { created, updated, failed };
    } catch (error) {
      console.error('Error batch assigning prompts:', error);
      throw error;
    }
  }
}