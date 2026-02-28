import React from 'react'
import { useTranslation } from 'react-i18next'
import { Separator } from '@/components/ui/separator'
import { useSimilarityStats } from './hooks/useSimilarityStats'
import { useSimilarityTest } from './hooks/useSimilarityTest'
import { useDuplicateScan } from './hooks/useDuplicateScan'
import { SimilaritySystemStatus } from './components/SimilaritySystemStatus'
import { SimilarityTestPanel } from './components/SimilarityTestPanel'
import { SimilarityDuplicateScan } from './components/SimilarityDuplicateScan'
import { SimilarityThresholds } from './components/SimilarityThresholds'

const SimilaritySettings: React.FC = () => {
  const { t } = useTranslation('settings')

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
  } = useSimilarityStats()

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
  } = useSimilarityTest()

  const { duplicateGroups, scanLoading, handleScanDuplicates } = useDuplicateScan(duplicateThreshold)

  return (
    <div className="space-y-4">
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

      <Separator />

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

      <Separator />

      <SimilarityDuplicateScan
        duplicateGroups={duplicateGroups}
        scanLoading={scanLoading}
        onScanDuplicates={() => handleScanDuplicates(t)}
        onImagesDeleted={() => {
          void handleScanDuplicates(t)
        }}
      />

      <Separator />

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
    </div>
  )
}

export default SimilaritySettings
