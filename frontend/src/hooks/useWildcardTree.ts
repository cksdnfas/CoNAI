import { useState, useCallback, useMemo } from 'react';
import { useSnackbar } from 'notistack';
import { useTranslation } from 'react-i18next';
import type { WildcardWithHierarchy } from '../services/api/wildcardApi';

/**
 * 와일드카드 트리 상태 및 제어 로직을 관리하는 커스텀 훅
 */
export function useWildcardTree(initialData: WildcardWithHierarchy[] = []) {
  const { enqueueSnackbar } = useSnackbar();
  const { t } = useTranslation(['wildcards', 'common']);

  const [selectedNode, setSelectedNode] = useState<WildcardWithHierarchy | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  /**
   * 폴더를 먼저, 파일을 나중에 정렬하는 함수
   */
  const sortNodesByHierarchy = useCallback((a: WildcardWithHierarchy, b: WildcardWithHierarchy) => {
    const aHasChildren = a.children && a.children.length > 0;
    const bHasChildren = b.children && b.children.length > 0;
    if (aHasChildren && !bHasChildren) return -1;
    if (!aHasChildren && bHasChildren) return 1;
    return a.name.localeCompare(b.name);
  }, []);

  /**
   * 노드 선택 핸들러
   */
  const handleSelect = useCallback((node: WildcardWithHierarchy) => {
    setSelectedNode(node);
  }, []);

  /**
   * 노드 확장/축소 토글
   */
  const handleToggle = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  /**
   * 모든 노드 ID를 재귀적으로 수집
   */
  const collectAllIds = useCallback((nodes: WildcardWithHierarchy[]): number[] => {
    return nodes.flatMap((node) => [
      node.id,
      ...(node.children ? collectAllIds(node.children) : [])
    ]);
  }, []);

  /**
   * 모든 노드 확장
   */
  const handleExpandAll = useCallback(() => {
    setExpandedIds(new Set(collectAllIds(initialData)));
  }, [initialData, collectAllIds]);

  /**
   * 모든 노드 축소
   */
  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  /**
   * 클립보드에 텍스트 복사
   */
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      enqueueSnackbar(`"${text}" ${t('wildcards:actions.copiedToClipboard') || '클립보드에 복사됨!'}`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(t('wildcards:errors.copyFailed') || '복사 실패', { variant: 'error' });
    }
  }, [enqueueSnackbar, t]);

  /**
   * 총 와일드카드 수 계산 (재귀적)
   */
  const totalCount = useMemo(() => {
    const countNodes = (nodes: WildcardWithHierarchy[]): number => {
      return nodes.reduce((sum, node) => {
        return sum + 1 + (node.children ? countNodes(node.children) : 0);
      }, 0);
    };
    return countNodes(initialData);
  }, [initialData]);

  /**
   * 첫 번째 루트 노드 자동 선택
   */
  const selectFirstNode = useCallback(() => {
    if (initialData.length > 0 && !selectedNode) {
      setSelectedNode(initialData[0]);
    }
  }, [initialData, selectedNode]);

  /**
   * 선택 초기화
   */
  const clearSelection = useCallback(() => {
    setSelectedNode(null);
  }, []);

  return {
    selectedNode,
    expandedIds,
    totalCount,
    handleSelect,
    handleToggle,
    handleExpandAll,
    handleCollapseAll,
    handleCopy,
    sortNodesByHierarchy,
    selectFirstNode,
    clearSelection,
    setSelectedNode
  };
}
