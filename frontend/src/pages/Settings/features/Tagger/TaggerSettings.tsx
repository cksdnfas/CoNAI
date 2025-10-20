import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Stack,
  Divider,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { TaggerSettings as TaggerSettingsType } from '../../../../services/settingsApi';

// Hooks
import { useTaggerSettings } from './hooks/useTaggerSettings';
import { useTaggerModels } from './hooks/useTaggerModels';
import { useTaggerBatch } from './hooks/useTaggerBatch';
import { useTaggerTest } from './hooks/useTaggerTest';

// Components
import { TaggerModelStatus } from './components/TaggerModelStatus';
import { TaggerConfigForm } from './components/TaggerConfigForm';
import { TaggerMemoryManagement } from './components/TaggerMemoryManagement';
import { TaggerBatchOperations } from './components/TaggerBatchOperations';
import { TaggerTestSection } from './components/TaggerTestSection';

interface TaggerSettingsProps {
  settings: TaggerSettingsType;
  onUpdate: (settings: Partial<TaggerSettingsType>) => Promise<void>;
}

const TaggerSettings: React.FC<TaggerSettingsProps> = ({ settings, onUpdate }) => {
  const { t } = useTranslation('settings');

  // Settings hook
  const {
    localSettings,
    loading,
    hasChanges,
    updateSettings,
    handleSave,
    handleReset,
  } = useTaggerSettings({ settings, onUpdate });

  // Models hook
  const {
    models,
    modelStatus,
    statusLoading,
    loading: modelsLoading,
    loadModels,
    loadModelStatus,
    handleLoadModel,
    handleUnloadModel,
    handleDownloadModel,
    handleCheckDependencies,
  } = useTaggerModels(localSettings.enabled);

  // Batch operations hook
  const {
    batchProcessing,
    batchProgress,
    batchTotal,
    untaggedCount,
    confirmDialog,
    setConfirmDialog,
    handleBatchTagUnprocessed,
    handleBatchTagAll,
  } = useTaggerBatch();

  // Test hook
  const {
    testImageId,
    testProcessing,
    testResult,
    setTestImageId,
    handleTestImage,
  } = useTaggerTest();

  // Dependency checking state
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dependencyStatus, setDependencyStatus] = useState<string | null>(null);
  const [dependencyAvailable, setDependencyAvailable] = useState<boolean | null>(null);

  const handleCheckDeps = async () => {
    setChecking(true);
    setDependencyStatus(null);
    try {
      const result = await handleCheckDependencies();
      setDependencyAvailable(result.available);
      setDependencyStatus(result.message);
    } catch (error) {
      setDependencyAvailable(false);
      setDependencyStatus('Failed to check dependencies');
    } finally {
      setChecking(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    await handleDownloadModel(localSettings.model, t);
    setDownloading(false);
  };

  return (
    <Box>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('tagger.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            {t('tagger.description')}
          </Typography>

          <Stack spacing={3} sx={{ mt: 3 }}>
            {/* Model Status Section */}
            {localSettings.enabled && (
              <TaggerModelStatus
                modelStatus={modelStatus}
                statusLoading={statusLoading}
                models={models}
                loading={modelsLoading}
                onLoadModel={() => handleLoadModel(localSettings.model, t)}
                onUnloadModel={() => handleUnloadModel(t)}
                onRefreshStatus={loadModelStatus}
              />
            )}

            <Divider />

            {/* Configuration Form */}
            <TaggerConfigForm
              localSettings={localSettings}
              models={models}
              onUpdateSettings={updateSettings}
              onDownloadModel={handleDownload}
              onRefreshModels={loadModels}
              downloading={downloading}
            />

            <Divider sx={{ my: 2 }} />

            {/* Memory Management Settings */}
            {localSettings.enabled && (
              <TaggerMemoryManagement
                localSettings={localSettings}
                onUpdateSettings={updateSettings}
              />
            )}

            <Divider sx={{ my: 2 }} />

            {/* Dependency Check */}
            <Box>
              <Button
                variant="outlined"
                startIcon={checking ? <CircularProgress size={20} /> : <CheckCircleIcon />}
                onClick={handleCheckDeps}
                disabled={checking || !localSettings.enabled}
                fullWidth
              >
                {checking ? t('tagger.buttons.checking') : t('tagger.buttons.checkDependencies')}
              </Button>

              {dependencyStatus && (
                <Alert severity={dependencyAvailable ? 'success' : 'error'} sx={{ mt: 2 }}>
                  {dependencyStatus}
                </Alert>
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Batch Operations Section */}
            {localSettings.enabled && (
              <TaggerBatchOperations
                batchProcessing={batchProcessing}
                batchProgress={batchProgress}
                batchTotal={batchTotal}
                untaggedCount={untaggedCount}
                confirmDialog={confirmDialog}
                onBatchTagUnprocessed={() => handleBatchTagUnprocessed(t)}
                onBatchTagAll={() => handleBatchTagAll(t)}
                onSetConfirmDialog={setConfirmDialog}
              />
            )}

            <Divider sx={{ my: 2 }} />

            {/* Test Section */}
            {localSettings.enabled && (
              <TaggerTestSection
                testImageId={testImageId}
                testProcessing={testProcessing}
                testResult={testResult}
                onSetTestImageId={setTestImageId}
                onTestImage={() => handleTestImage(t)}
              />
            )}

            {/* Save/Reset Buttons */}
            <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={!hasChanges || loading}
                fullWidth
              >
                {loading ? <CircularProgress size={24} /> : t('tagger.buttons.save')}
              </Button>
              <Button
                variant="outlined"
                onClick={handleReset}
                disabled={!hasChanges || loading}
                fullWidth
              >
                {t('tagger.buttons.cancel')}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
};

export default TaggerSettings;
