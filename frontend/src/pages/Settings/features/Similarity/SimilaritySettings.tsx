import React from 'react';
import { Box, Divider } from '@mui/material';
import { useTranslation } from 'react-i18next';

// Hooks
import { useSimilarityStats } from './hooks/useSimilarityStats';
import { useSimilarityTest } from './hooks/useSimilarityTest';
import { useDuplicateScan } from './hooks/useDuplicateScan';

// Components
import { SimilaritySystemStatus } from './components/SimilaritySystemStatus';
import { SimilarityTestPanel } from './components/SimilarityTestPanel';
import { SimilarityDuplicateScan } from './components/SimilarityDuplicateScan';
import { SimilarityThresholds } from './components/SimilarityThresholds';

const SimilaritySettings: React.FC = () => {
  const { t } = useTranslation('settings');

  // Stats hook
  const {
    stats,
    rebuilding,
    rebuildProgress,
    rebuildProcessed,
    rebuildTotal,
    autoGenerateHash,
    loadStats,
    handleAutoGenerateHashChange,
    handleRebuildHashes,
  } = useSimilarityStats();

  // Test hook
  const {
    testImageId,
    testLoading,
    testResults,
    testType,
    queryImage,
    duplicateThreshold,
    similarThreshold,
    colorThreshold,
    searchLimit,
    setTestImageId,
    setTestType,
    setDuplicateThreshold,
    setSimilarThreshold,
    setColorThreshold,
    setSearchLimit,
    handleTestSearch,
  } = useSimilarityTest();

  // Duplicate scan hook
  const {
    duplicateGroups,
    scanLoading,
    handleScanDuplicates,
  } = useDuplicateScan(duplicateThreshold);

  return (
    <Box>
      {/* System Status */}
      <SimilaritySystemStatus
        stats={stats}
        rebuilding={rebuilding}
        rebuildProgress={rebuildProgress}
        rebuildProcessed={rebuildProcessed}
        rebuildTotal={rebuildTotal}
        autoGenerateHash={autoGenerateHash}
        onAutoGenerateHashChange={(checked) => handleAutoGenerateHashChange(checked, t)}
        onRebuildHashes={() => handleRebuildHashes(t)}
        onRefreshStats={loadStats}
      />

      <Divider sx={{ my: 3 }} />

      {/* Test & Preview */}
      <SimilarityTestPanel
        testImageId={testImageId}
        testLoading={testLoading}
        testType={testType}
        queryImage={queryImage}
        testResults={testResults}
        onSetTestImageId={setTestImageId}
        onSetTestType={setTestType}
        onTestSearch={() => handleTestSearch(t)}
      />

      <Divider sx={{ my: 3 }} />

      {/* Duplicate Analysis */}
      <SimilarityDuplicateScan
        duplicateGroups={duplicateGroups}
        scanLoading={scanLoading}
        onScanDuplicates={() => handleScanDuplicates(t)}
        onImagesDeleted={() => {
          // 이미지 삭제 후 다시 스캔
          handleScanDuplicates(t);
        }}
      />

      <Divider sx={{ my: 3 }} />

      {/* Threshold Settings */}
      <SimilarityThresholds
        duplicateThreshold={duplicateThreshold}
        similarThreshold={similarThreshold}
        colorThreshold={colorThreshold}
        searchLimit={searchLimit}
        onSetDuplicateThreshold={setDuplicateThreshold}
        onSetSimilarThreshold={setSimilarThreshold}
        onSetColorThreshold={setColorThreshold}
        onSetSearchLimit={setSearchLimit}
      />
    </Box>
  );
};

export default SimilaritySettings;
