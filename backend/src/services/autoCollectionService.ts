import { GroupModel, ImageGroupModel } from '../models/Group';
import { ImageModel } from '../models/Image';
import { GroupRecord, AutoCollectCondition, AutoCollectResult } from '@comfyui-image-manager/shared';
import { ImageRecord } from '@comfyui-image-manager/shared';
import { AutoTagSearchService } from './autoTagSearchService';
import { AutoTagSearchParams } from '../types/autoTag';

export class AutoCollectionService {
  /**
   * 정규식에서 사용할 특수 문자를 이스케이프
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

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
   * Note: async로 변경되어 rating_score 조건도 지원
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
        if (condition.exact_match && typeof value === 'string') {
          const pattern = case_sensitive
            ? new RegExp(`\\b${this.escapeRegex(value)}\\b`)
            : new RegExp(`\\b${this.escapeRegex(value)}\\b`, 'i');
          return pattern.test(image.prompt || '');
        }
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
        if (condition.exact_match && typeof value === 'string') {
          const pattern = case_sensitive
            ? new RegExp(`\\b${this.escapeRegex(value)}\\b`)
            : new RegExp(`\\b${this.escapeRegex(value)}\\b`, 'i');
          return pattern.test(image.negative_prompt || '');
        }
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
        if (condition.exact_match && typeof value === 'string') {
          const pattern = case_sensitive
            ? new RegExp(`\\b${this.escapeRegex(value)}\\b`)
            : new RegExp(`\\b${this.escapeRegex(value)}\\b`, 'i');
          return pattern.test(image.model_name || '');
        }
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

      case 'auto_tag_rating_score':
        return await this.evaluateRatingScoreCondition(image, condition);

      // 중복 이미지 검색 조건
      case 'duplicate_exact':
        return await this.evaluateDuplicateCondition(image, condition, 0);

      case 'duplicate_near':
        return await this.evaluateDuplicateCondition(image, condition, 5);

      case 'duplicate_similar':
        return await this.evaluateDuplicateCondition(image, condition, 15);

      case 'duplicate_custom':
        if (condition.hamming_threshold === undefined) return false;
        return await this.evaluateDuplicateCondition(image, condition, condition.hamming_threshold);

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
   * Rating Score 조건 평가 (가중치 기반)
   */
  private static async evaluateRatingScoreCondition(
    image: ImageRecord,
    condition: AutoCollectCondition
  ): Promise<boolean> {
    if (!image.auto_tags) return false;

    try {
      const autoTags = JSON.parse(image.auto_tags);
      if (!autoTags.rating) return false;

      // RatingScoreService를 이용한 점수 계산
      const { RatingScoreService } = await import('./ratingScoreService');
      const scoreResult = await RatingScoreService.calculateScore(autoTags.rating);
      const score = scoreResult.score;

      // min_score 체크
      if (condition.min_score !== undefined && score < condition.min_score) {
        return false;
      }

      // max_score 체크
      if (condition.max_score !== undefined && score > condition.max_score) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Failed to evaluate rating_score condition:', error);
      return false;
    }
  }

  /**
   * 중복 이미지 조건 평가
   * perceptual_hash를 사용하여 Hamming distance 기반 중복 검색
   */
  private static async evaluateDuplicateCondition(
    image: ImageRecord,
    condition: AutoCollectCondition,
    threshold: number
  ): Promise<boolean> {
    // perceptual_hash가 없으면 평가 불가
    if (!image.perceptual_hash) {
      return false;
    }

    try {
      // ImageSimilarityModel을 동적 임포트하여 순환 참조 방지
      const { ImageSimilarityModel } = await import('../models/Image/ImageSimilarityModel');

      // 중복 이미지 검색
      const duplicates = await ImageSimilarityModel.findDuplicates(image.id, {
        threshold,
        includeMetadata: true
      });

      // 중복 이미지가 하나라도 있으면 true
      return duplicates.length > 0;
    } catch (error) {
      console.warn('Failed to evaluate duplicate condition:', error);
      return false;
    }
  }

  /**
   * 특정 그룹의 자동수집 실행
   * - 수동으로 추가된 이미지는 삭제하지 않음
   * - 자동수집 조건 변경 시에도 수동 추가 이미지 유지
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

      // 기존 자동수집 이미지들만 제거 (수동 추가 이미지는 유지)
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
            // 이미 그룹에 속해있는지 확인 (manual/auto 모두 포함)
            const alreadyInGroup = await ImageGroupModel.isImageInGroup(groupId, image.id);

            // 이미 그룹에 있으면 스킵 (수동 추가된 이미지 보호)
            if (!alreadyInGroup) {
              try {
                await ImageGroupModel.addImageToGroup(groupId, image.id, 'auto');
                addedCount++;
              } catch (err) {
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
        'auto_tag_has_character', 'auto_tag_exists',
        'auto_tag_rating_score',  // 가중치 기반 rating 점수 조건
        // 중복 이미지 검색 조건
        'duplicate_exact', 'duplicate_near',
        'duplicate_similar', 'duplicate_custom'
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

        // rating_score는 별도 검증 (가중치 기반이므로 0-1 범위가 아님)
        if (condition.type === 'auto_tag_rating_score') {
          // 이미 위에서 검증됨 (line 558-569)
        } else {
          // 일반 점수 범위 검증 (rating, general, character는 0-1 범위)
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

        // rating_score 조건 검증
        if (condition.type === 'auto_tag_rating_score') {
          if (condition.min_score === undefined && condition.max_score === undefined) {
            errors.push(`Condition ${i + 1}: rating_score requires at least min_score or max_score`);
          }
          if (condition.min_score !== undefined && condition.min_score < 0) {
            errors.push(`Condition ${i + 1}: min_score cannot be negative`);
          }
          if (condition.max_score !== undefined && condition.max_score < 0) {
            errors.push(`Condition ${i + 1}: max_score cannot be negative`);
          }
          if (condition.min_score !== undefined && condition.max_score !== undefined && condition.min_score >= condition.max_score) {
            errors.push(`Condition ${i + 1}: min_score must be less than max_score`);
          }
        }
      }

      // 중복 이미지 조건 검증
      if (condition.type.startsWith('duplicate_')) {
        // duplicate_custom은 hamming_threshold가 필수
        if (condition.type === 'duplicate_custom') {
          if (condition.hamming_threshold === undefined) {
            errors.push(`Condition ${i + 1}: hamming_threshold is required for duplicate_custom`);
          } else if (condition.hamming_threshold < 0 || condition.hamming_threshold > 64) {
            errors.push(`Condition ${i + 1}: hamming_threshold must be between 0 and 64`);
          }
        }

        // value 필드는 중복 조건에서 사용되지 않으므로 빈 문자열로 설정 가능
        // 하지만 타입 시스템 때문에 필수이므로 검증하지 않음
      }
    }

    return { valid: errors.length === 0, errors };
  }
}