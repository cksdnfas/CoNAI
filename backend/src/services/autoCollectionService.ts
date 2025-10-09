import { GroupModel, ImageGroupModel } from '../models/Group';
import { ImageModel } from '../models/Image';
import { GroupRecord, AutoCollectCondition, AutoCollectResult } from '../types/group';
import { ImageRecord } from '../types/image';

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
    let searchValue = case_sensitive ? value : value.toLowerCase();

    switch (type) {
      case 'prompt_contains':
        targetText = case_sensitive ? (image.prompt || '') : (image.prompt || '').toLowerCase();
        return targetText.includes(searchValue);

      case 'prompt_regex':
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

      default:
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

      if (!condition.type || !condition.value) {
        errors.push(`Condition ${i + 1}: type and value are required`);
        continue;
      }

      const validTypes = [
        'prompt_contains', 'prompt_regex',
        'negative_prompt_contains', 'negative_prompt_regex',
        'ai_tool', 'model_name'
      ];

      if (!validTypes.includes(condition.type)) {
        errors.push(`Condition ${i + 1}: invalid type "${condition.type}"`);
      }

      // 정규식 유효성 검사
      if (condition.type.includes('regex')) {
        try {
          new RegExp(condition.value);
        } catch (err) {
          errors.push(`Condition ${i + 1}: invalid regex pattern "${condition.value}"`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}