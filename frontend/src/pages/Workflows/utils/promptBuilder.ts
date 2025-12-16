import type { Workflow, MarkedField } from '../../../services/api/workflowApi';
import { parseObjectWildcards, type ObjectParseResult } from '../../../utils/wildcardParser';
import { cleanPrompt, isPromptEmpty } from '../../../utils/promptCleaner';

/**
 * 이미지를 Base64로 변환하는 헬퍼 함수
 * @param imagePath 이미지 경로 또는 Data URL
 * @returns Base64 문자열
 */
async function imageToBase64(imagePath: string): Promise<string> {
  // 이미 Base64 Data URL인 경우
  if (imagePath.startsWith('data:')) {
    return imagePath;
  }

  // 서버 경로인 경우 fetch로 가져와서 Base64로 변환
  try {
    const response = await fetch(`http://localhost:1666${imagePath}`);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to convert image to Base64:', error);
    throw error;
  }
}

/**
 * 워크플로우 JSON과 폼 데이터를 결합하여 최종 prompt 데이터 생성
 * @param workflow 워크플로우 객체
 * @param formData 폼 입력 데이터
 * @returns 생성된 prompt 데이터
 */
export async function buildPromptData(
  workflow: Workflow | null,
  formData: Record<string, any>
): Promise<Record<string, any>> {
  if (!workflow?.workflow_json || !workflow?.marked_fields) {
    return {};
  }

  try {
    const workflowObj = JSON.parse(workflow.workflow_json);
    const promptData = JSON.parse(JSON.stringify(workflowObj)); // Deep clone

    // Marked Fields 값을 JSON Path에 따라 설정 (비동기 처리)
    for (const field of workflow.marked_fields) {
      const path = field.jsonPath.split('.');
      let current: any = promptData;

      for (let i = 0; i < path.length - 1; i++) {
        if (!(path[i] in current)) {
          current[path[i]] = {};
        }
        current = current[path[i]];
      }

      const lastKey = path[path.length - 1];
      let value = formData[field.id];

      // 타입에 따라 변환
      if (field.type === 'number') {
        current[lastKey] = parseFloat(value) || 0;
      } else if (field.type === 'image') {
        // 이미지는 Base64로 변환
        if (value) {
          current[lastKey] = await imageToBase64(value);
        } else {
          current[lastKey] = '';
        }
      } else {
        // 경로 구분자 정규화: 원본 값의 구분자 형식 유지
        // 원본 값이 백슬래시를 포함하는 경로라면, 새 값도 백슬래시로 변환
        const originalValue = current[lastKey];
        if (typeof originalValue === 'string' &&
          typeof value === 'string' &&
          originalValue.includes('\\') &&
          value.includes('/')) {
          // 원본이 Windows 경로 형식(백슬래시)이고, 새 값이 Unix 경로 형식(슬래시)이면
          // 새 값의 슬래시를 백슬래시로 변환
          value = value.replace(/\//g, '\\');
        }
        current[lastKey] = value;
      }
    }

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
): Promise<ObjectParseResult> {
  const promptData = await buildPromptData(workflow, formData);

  console.log('[ComfyUI Wildcard] Before parsing:', JSON.stringify(promptData).substring(0, 200));

  // 와일드카드 파싱 (객체 전체를 재귀적으로 파싱)
  const parseResult = await parseObjectWildcards(promptData, 'comfyui');

  console.log('[ComfyUI Wildcard] After parsing:', JSON.stringify(parseResult.data).substring(0, 200));
  console.log('[ComfyUI Wildcard] Was changed:', JSON.stringify(promptData) !== JSON.stringify(parseResult.data));
  console.log('[ComfyUI Wildcard] Empty wildcards:', parseResult.emptyWildcards);

  return parseResult;
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

/**
 * 파싱된 워크플로우 데이터에서 프롬프트 필드가 비어있는지 확인
 * @param promptData 파싱된 프롬프트 데이터
 * @returns 프롬프트가 비어있으면 true
 */
export function hasEmptyPrompts(promptData: Record<string, any>): boolean {
  // 워크플로우 JSON에서 일반적인 프롬프트 필드를 찾아 확인
  // 재귀적으로 "text" 필드를 찾아서 확인
  function findTextFields(obj: any): string[] {
    const texts: string[] = [];

    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        const value = obj[key];

        if (key === 'text' && typeof value === 'string') {
          texts.push(value);
        } else if (key === 'inputs' && value && typeof value === 'object') {
          // ComfyUI의 inputs 객체에서 text 필드 확인
          if ('text' in value && typeof value.text === 'string') {
            texts.push(value.text);
          }
        }

        if (typeof value === 'object') {
          texts.push(...findTextFields(value));
        }
      }
    }

    return texts;
  }

  const textFields = findTextFields(promptData);

  // 모든 텍스트 필드가 비어있으면 true
  return textFields.length > 0 && textFields.every(text => isPromptEmpty(text));
}
