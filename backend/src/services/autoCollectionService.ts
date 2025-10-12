import { GroupModel, ImageGroupModel } from '../models/Group';
import { ImageModel } from '../models/Image';
import { GroupRecord, AutoCollectCondition, AutoCollectResult } from '../types/group';
import { ImageRecord } from '../types/image';
import { AutoTagSearchService } from './autoTagSearchService';
import { AutoTagSearchParams } from '../types/autoTag';

export class AutoCollectionService {
  /**
   * 단일 이미지가 그룹 조건에 맞는지 확인
   */
  static async checkImageMatchesConditions(
    image: ImageRecord,
    conditions: AutoCollectCondition[]
  ): Promise<boolean> {
    if (!conditions || conditions.length === 0) {
      return false;
    }

    for (const condition of conditions) {
      if (await this.evaluateCondition(image, condition)) {
        return true; // OR 조건 (하나라도 맞으면 포함)
      }
    }

    return false;
  }

  /**
   * 개별 조건 평가
   */
  private static async evaluateCondition(
    image: ImageRecord,
    condition: AutoCollectCondition
  ): Promise<boolean> {
    const { type, value, case_sensitive = false } = condition;

    let targetText = '';
    let searchValue = '';

    // 문자열 value인 경우에만 toLowerCase 처리
    if (typeof value === 'string') {
      searchValue = case_sensitive ? value : value.toLowerCase();
    }

    switch (type) {
      case 'prompt_contains':
        targetText = case_sensitive ? (image.prompt || '') : (image.prompt || '').toLowerCase();
        return targetText.includes(searchValue);

      case 'prompt_regex':
        if (typeof value !== 'string') return false;
        try {
          const flags = case_sensitive ? 'g' : 'gi';
          const regex = new RegExp(value, flags);
          return regex.test(image.prompt || '');
        } catch (err) {
          console.warn('Invalid regex pattern:', value);
          return false;
        }

      case 'negative_prompt_contains':
        targetText = case_sensitive ? (image.negative_prompt || '') : (image.negative_prompt || '').toLowerCase();
        return targetText.includes(searchValue);

      case 'negative_prompt_regex':
        if (typeof value !== 'string') return false;
        try {
          const flags = case_sensitive ? 'g' : 'gi';
          const regex = new RegExp(value, flags);
          return regex.test(image.negative_prompt || '');
        } catch (err) {
          console.warn('Invalid regex pattern:', value);
          return false;
        }

      case 'ai_tool':
        targetText = case_sensitive ? (image.ai_tool || '') : (image.ai_tool || '').toLowerCase();
        return targetText === searchValue;

      case 'model_name':
        targetText = case_sensitive ? (image.model_name || '') : (image.model_name || '').toLowerCase();
        return targetText.includes(searchValue);

      // 오토태그 관련 조건 평가
      case 'auto_tag_exists':
        // value가 true면 오토태그가 있어야 함, false면 없어야 함
        const shouldHaveAutoTags = Boolean(value);
        const hasAutoTags = image.auto_tags !== null && image.auto_tags !== undefined;
        return shouldHaveAutoTags === hasAutoTags;

      case 'auto_tag_rating':
        return this.evaluateRatingCondition(image, condition);

      case 'auto_tag_general':
        return this.evaluateGeneralTagCondition(image, condition);

      case 'auto_tag_character':
        return this.evaluateCharacterCondition(image, condition);

      case 'auto_tag_model':
        return this.evaluateAutoTagModelCondition(image, condition);

      case 'auto_tag_has_character':
        return this.evaluateHasCharacterCondition(image, condition);

      default:
        return false;
    }
  }

  /**
   * Rating 조건 평가
   */
  private static evaluateRatingCondition(
    image: ImageRecord,
    condition: AutoCollectCondition
  ): boolean {
    if (!image.auto_tags || !condition.rating_type) return false;

    try {
      const autoTags = JSON.parse(image.auto_tags);
      if (!autoTags.rating) return false;

      const ratingValue = autoTags.rating[condition.rating_type];
      if (ratingValue === undefined || ratingValue === null) return false;

      // min_score 체크
      if (condition.min_score !== undefined && ratingValue < condition.min_score) {
        return false;
      }

      // max_score 체크
      if (condition.max_score !== undefined && ratingValue > condition.max_score) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Failed to parse auto_tags for rating condition:', error);
      return false;
    }
  }

  /**
   * General 태그 조건 평가
   */
  private static evaluateGeneralTagCondition(
    image: ImageRecord,
    condition: AutoCollectCondition
  ): boolean {
    if (!image.auto_tags || typeof condition.value !== 'string') return false;

    try {
      const autoTags = JSON.parse(image.auto_tags);
      if (!autoTags.general) return false;

      const tagName = condition.value;
      const tagValue = autoTags.general[tagName];

      if (tagValue === undefined || tagValue === null) return false;

      // min_score 체크
      if (condition.min_score !== undefined && tagValue < condition.min_score) {
        return false;
      }

      // max_score 체크
      if (condition.max_score !== undefined && tagValue > condition.max_score) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Failed to parse auto_tags for general tag condition:', error);
      return false;
    }
  }

  /**
   * Character 조건 평가
   */
  private static evaluateCharacterCondition(
    image: ImageRecord,
    condition: AutoCollectCondition
  ): boolean {
    if (!image.auto_tags || typeof condition.value !== 'string') return false;

    try {
      const autoTags = JSON.parse(image.auto_tags);
      if (!autoTags.character) return false;

      const characterName = condition.value;
      const characterValue = autoTags.character[characterName];

      if (characterValue === undefined || characterValue === null) return false;

      // min_score 체크
      if (condition.min_score !== undefined && characterValue < condition.min_score) {
        return false;
      }

      // max_score 체크
      if (condition.max_score !== undefined && characterValue > condition.max_score) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Failed to parse auto_tags for character condition:', error);
      return false;
    }
  }

  /**
   * 오토태그의 model 조건 평가
   */
  private static evaluateAutoTagModelCondition(
    image: ImageRecord,
    condition: AutoCollectCondition
  ): boolean {
    if (!image.auto_tags || typeof condition.value !== 'string') return false;

    try {
      const autoTags = JSON.parse(image.auto_tags);
      if (!autoTags.model) return false;

      const searchValue = condition.case_sensitive
        ? condition.value
        : condition.value.toLowerCase();

      const modelValue = condition.case_sensitive
        ? autoTags.model
        : autoTags.model.toLowerCase();

      return modelValue === searchValue;
    } catch (error) {
      console.warn('Failed to parse auto_tags for model condition:', error);
      return false;
    }
  }

  /**
   * 캐릭터 존재 여부 조건 평가
   */
  private static evaluateHasCharacterCondition(
    image: ImageRecord,
    condition: AutoCollectCondition
  ): boolean {
    if (!image.auto_tags) return false;

    try {
      const autoTags = JSON.parse(image.auto_tags);
      const hasCharacter = autoTags.character && Object.keys(autoTags.character).length > 0;

      // value가 true면 캐릭터가 있어야 함, false면 없어야 함
      const shouldHaveCharacter = Boolean(condition.value);

      return shouldHaveCharacter === hasCharacter;
    } catch (error) {
      console.warn('Failed to parse auto_tags for has_character condition:', error);
      return false;
    }
  }

  /**
   * 특정 그룹의 자동수집 실행
   */
  static async runAutoCollectionForGroup(groupId: number): Promise<AutoCollectResult> {
    const startTime = Date.now();

    try {
      const group = await GroupModel.findById(groupId);
      if (!group || !group.auto_collect_enabled || !group.auto_collect_conditions) {
        throw new Error('Group not found or auto collection not enabled');
      }

      const conditions: AutoCollectCondition[] = JSON.parse(group.auto_collect_conditions);
      if (!conditions || conditions.length === 0) {
        throw new Error('No valid conditions found');
      }

      // 기존 자동수집 이미지들 제거
      const removedCount = await ImageGroupModel.removeAutoCollectedImages(groupId);

      // 모든 이미지 검사
      let addedCount = 0;
      let page = 1;
      const limit = 100;
      let hasMore = true;

      while (hasMore) {
        const result = await ImageModel.findAll(page, limit);
        const images = result.images;

        if (images.length === 0) {
          hasMore = false;
          break;
        }

        for (const image of images) {
          const matches = await this.checkImageMatchesConditions(image, conditions);
          if (matches) {
            try {
              await ImageGroupModel.addImageToGroup(groupId, image.id, 'auto');
              addedCount++;
            } catch (err) {
              // 이미 존재하는 경우 무시 (UNIQUE 제약)
              if (!(err as Error).message.includes('UNIQUE constraint failed')) {
                console.warn('Error adding image to group:', err);
              }
            }
          }
        }

        page++;
        hasMore = images.length === limit;
      }

      // 마지막 실행 시간 업데이트
      await GroupModel.updateAutoCollectLastRun(groupId);

      const executionTime = Date.now() - startTime;

      return {
        group_id: groupId,
        group_name: group.name,
        images_added: addedCount,
        images_removed: removedCount,
        execution_time: executionTime
      };

    } catch (error) {
      console.error(`Auto collection failed for group ${groupId}:`, error);
      throw error;
    }
  }

  /**
   * 모든 자동수집 활성화된 그룹들에 대해 실행
   */
  static async runAutoCollectionForAllGroups(): Promise<AutoCollectResult[]> {
    try {
      const groups = await GroupModel.findAutoCollectEnabled();
      const results: AutoCollectResult[] = [];

      for (const group of groups) {
        try {
          const result = await this.runAutoCollectionForGroup(group.id);
          results.push(result);
        } catch (error) {
          console.error(`Auto collection failed for group ${group.name} (${group.id}):`, error);
          // 개별 그룹 실패해도 다른 그룹들은 계속 처리
          results.push({
            group_id: group.id,
            group_name: group.name,
            images_added: 0,
            images_removed: 0,
            execution_time: 0
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Auto collection for all groups failed:', error);
      throw error;
    }
  }

  /**
   * 새로 업로드된 이미지에 대한 자동수집 실행
   */
  static async runAutoCollectionForNewImage(imageId: number): Promise<AutoCollectResult[]> {
    try {
      const image = await ImageModel.findById(imageId);
      if (!image) {
        throw new Error('Image not found');
      }

      const groups = await GroupModel.findAutoCollectEnabled();
      const results: AutoCollectResult[] = [];

      for (const group of groups) {
        try {
          if (!group.auto_collect_conditions) {
            continue;
          }

          const conditions: AutoCollectCondition[] = JSON.parse(group.auto_collect_conditions);
          const matches = await this.checkImageMatchesConditions(image, conditions);

          if (matches) {
            // 이미 그룹에 속해있는지 확인
            const alreadyInGroup = await ImageGroupModel.isImageInGroup(group.id, imageId);
            if (!alreadyInGroup) {
              await ImageGroupModel.addImageToGroup(group.id, imageId, 'auto');
              results.push({
                group_id: group.id,
                group_name: group.name,
                images_added: 1,
                images_removed: 0,
                execution_time: 0
              });
            }
          }
        } catch (error) {
          console.error(`Auto collection failed for new image in group ${group.name}:`, error);
        }
      }

      return results;
    } catch (error) {
      console.error('Auto collection for new image failed:', error);
      throw error;
    }
  }

  /**
   * 조건 유효성 검증
   */
  static validateConditions(conditions: AutoCollectCondition[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!Array.isArray(conditions)) {
      errors.push('Conditions must be an array');
      return { valid: false, errors };
    }

    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];

      if (!condition.type) {
        errors.push(`Condition ${i + 1}: type is required`);
        continue;
      }

      const validTypes = [
        'prompt_contains', 'prompt_regex',
        'negative_prompt_contains', 'negative_prompt_regex',
        'ai_tool', 'model_name',
        // 오토태그 조건
        'auto_tag_rating', 'auto_tag_general',
        'auto_tag_character', 'auto_tag_model',
        'auto_tag_has_character', 'auto_tag_exists'
      ];

      if (!validTypes.includes(condition.type)) {
        errors.push(`Condition ${i + 1}: invalid type "${condition.type}"`);
      }

      // value 필수 체크 (일부 조건은 value가 boolean일 수 있음)
      if (condition.value === undefined || condition.value === null) {
        errors.push(`Condition ${i + 1}: value is required`);
        continue;
      }

      // 정규식 유효성 검사
      if (condition.type.includes('regex')) {
        try {
          new RegExp(condition.value as string);
        } catch (err) {
          errors.push(`Condition ${i + 1}: invalid regex pattern "${condition.value}"`);
        }
      }

      // 오토태그 관련 조건 검증
      if (condition.type.startsWith('auto_tag_')) {
        // rating 조건은 rating_type이 필수
        if (condition.type === 'auto_tag_rating') {
          if (!condition.rating_type) {
            errors.push(`Condition ${i + 1}: rating_type is required for auto_tag_rating`);
          } else if (!['general', 'sensitive', 'questionable', 'explicit'].includes(condition.rating_type)) {
            errors.push(`Condition ${i + 1}: invalid rating_type "${condition.rating_type}"`);
          }
        }

        // 점수 범위 검증
        if (condition.min_score !== undefined) {
          if (condition.min_score < 0 || condition.min_score > 1) {
            errors.push(`Condition ${i + 1}: min_score must be between 0 and 1`);
          }
        }

        if (condition.max_score !== undefined) {
          if (condition.max_score < 0 || condition.max_score > 1) {
            errors.push(`Condition ${i + 1}: max_score must be between 0 and 1`);
          }
        }

        if (condition.min_score !== undefined && condition.max_score !== undefined) {
          if (condition.min_score > condition.max_score) {
            errors.push(`Condition ${i + 1}: min_score cannot be greater than max_score`);
          }
        }

        // auto_tag_exists와 auto_tag_has_character는 boolean value만 허용
        if (condition.type === 'auto_tag_exists' || condition.type === 'auto_tag_has_character') {
          if (typeof condition.value !== 'boolean') {
            errors.push(`Condition ${i + 1}: value must be boolean for ${condition.type}`);
          }
        }

        // 태그/캐릭터명 조건은 string value만 허용
        if (['auto_tag_general', 'auto_tag_character', 'auto_tag_model'].includes(condition.type)) {
          if (typeof condition.value !== 'string') {
            errors.push(`Condition ${i + 1}: value must be string for ${condition.type}`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}