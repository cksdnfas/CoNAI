import type { Workflow, MarkedField } from '../../../services/api/workflowApi';
import { parseObjectWildcards } from '../../../utils/wildcardParser';

/**
 * 워크플로우 JSON과 폼 데이터를 결합하여 최종 prompt 데이터 생성
 * @param workflow 워크플로우 객체
 * @param formData 폼 입력 데이터
 * @returns 생성된 prompt 데이터
 */
export function buildPromptData(
  workflow: Workflow | null,
  formData: Record<string, any>
): Record<string, any> {
  if (!workflow?.workflow_json || !workflow?.marked_fields) {
    return {};
  }

  try {
    const workflowObj = JSON.parse(workflow.workflow_json);
    const promptData = JSON.parse(JSON.stringify(workflowObj)); // Deep clone

    // Marked Fields 값을 JSON Path에 따라 설정
    workflow.marked_fields.forEach((field: MarkedField) => {
      const path = field.jsonPath.split('.');
      let current: any = promptData;

      for (let i = 0; i < path.length - 1; i++) {
        if (!(path[i] in current)) {
          current[path[i]] = {};
        }
        current = current[path[i]];
      }

      const lastKey = path[path.length - 1];
      const value = formData[field.id];

      // 타입에 따라 변환
      if (field.type === 'number') {
        current[lastKey] = parseFloat(value) || 0;
      } else {
        current[lastKey] = value;
      }
    });

    return promptData;
  } catch (err) {
    console.error('Failed to build prompt data:', err);
    return {};
  }
}

/**
 * 와일드카드 파싱이 포함된 워크플로우 prompt 데이터 생성 (비동기)
 * @param workflow 워크플로우 객체
 * @param formData 폼 입력 데이터
 * @returns 와일드카드가 파싱된 prompt 데이터
 */
export async function buildPromptDataWithWildcards(
  workflow: Workflow | null,
  formData: Record<string, any>
): Promise<Record<string, any>> {
  const promptData = buildPromptData(workflow, formData);

  // 와일드카드 파싱 (객체 전체를 재귀적으로 파싱)
  return await parseObjectWildcards(promptData, 'comfyui');
}

/**
 * 폼 데이터 초기화 함수
 * @param workflow 워크플로우 객체
 * @returns 초기화된 폼 데이터
 */
export function initializeFormData(workflow: Workflow): Record<string, any> {
  if (!workflow.marked_fields) {
    return {};
  }

  const initialData: Record<string, any> = {};
  workflow.marked_fields.forEach((field: MarkedField) => {
    initialData[field.id] = field.default_value || '';
  });

  return initialData;
}
