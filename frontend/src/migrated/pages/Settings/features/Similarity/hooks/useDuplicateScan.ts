import { useState } from 'react';
import { similarityApi, type DuplicateGroup } from '../../../../../services/similarityApi';

export const useDuplicateScan = (duplicateThreshold: number) => {
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [scanLoading, setScanLoading] = useState(false);

  const handleScanDuplicates = async (t: any) => {
    setScanLoading(true);
    setDuplicateGroups([]);
    try {
      const groups = await similarityApi.findAllDuplicates({
        threshold: duplicateThreshold,
        minGroupSize: 2,
      });
      setDuplicateGroups(groups);
    } catch (error) {
      alert(t('similarity.test.searchFailed'));
      console.error('Failed to scan duplicates:', error);
    } finally {
      setScanLoading(false);
    }
  };

  return {
    duplicateGroups,
    scanLoading,
    handleScanDuplicates,
  };
};
