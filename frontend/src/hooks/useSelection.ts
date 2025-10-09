import { useState, useCallback } from 'react';

export const useSelection = () => {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const toggleSelection = useCallback((id: number) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(selectedId => selectedId !== id)
        : [...prev, id]
    );
  }, []);

  const selectAll = useCallback((ids: number[]) => {
    setSelectedIds(ids);
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const isSelected = useCallback((id: number) => {
    return selectedIds.includes(id);
  }, [selectedIds]);

  const toggleSelectAll = useCallback((allIds: number[]) => {
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