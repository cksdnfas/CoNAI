import { useState } from 'react';
import { workflowApi, type Workflow } from '../../../services/api/workflowApi';
import { buildPromptData, initializeFormData } from '../utils/promptBuilder';

/**
 * 워크플로우 데이터 관리 Hook
 * - 워크플로우 로딩
 * - 폼 데이터 관리
 * - Prompt 데이터 빌드
 */
export function useWorkflowData(workflowId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});

  /**
   * 워크플로우 로딩
   */
  const loadWorkflow = async () => {
    if (!workflowId) return;

    try {
      setLoading(true);
      const response = await workflowApi.getWorkflow(parseInt(workflowId));
      const workflowData: Workflow = response.data;

      setWorkflow(workflowData);

      // 기본값으로 formData 초기화
      const initialData = initializeFormData(workflowData);
      setFormData(initialData);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 폼 필드 값 변경 핸들러
   */
  const handleFieldChange = (fieldId: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [fieldId]: value
    }));
  };

  /**
   * Prompt 데이터 빌드
   */
  const getPromptData = () => {
    return buildPromptData(workflow, formData);
  };

  return {
    loading,
    error,
    setError,
    workflow,
    formData,
    loadWorkflow,
    handleFieldChange,
    getPromptData
  };
}
