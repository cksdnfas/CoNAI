import { useState, useCallback } from 'react';

// ✅ composite_hash 기반으로 완전 전환
export const useSelection = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleSelection = useCallback((compositeHash: string) => {
    setSelectedIds(prev =>
      prev.includes(compositeHash)
        ? prev.filter(selectedId => selectedId !== compositeHash)
        : [...prev, compositeHash]
    );
  }, []);

  const selectAll = useCallback((compositeHashes: string[]) => {
    setSelectedIds(compositeHashes);
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const isSelected = useCallback((compositeHash: string) => {
    return selectedIds.includes(compositeHash);
  }, [selectedIds]);

  const toggleSelectAll = useCallback((allIds: string[]) => {
    if (selectedIds.length === allIds.length) {
      deselectAll();
    } else {
      selectAll(allIds);
    }
  }, [selectedIds.length, selectAll, deselectAll]);

  return {
    selectedIds,
    toggleSelection,
    selectAll,
    deselectAll,
    isSelected,
    toggleSelectAll,
    selectedCount: selectedIds.length,
  };
};
