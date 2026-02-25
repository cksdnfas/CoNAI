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
  TextField,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { InfoTooltip } from '../../../../components/common';
import { useTranslation } from 'react-i18next';
import type { TaggerSettings as TaggerSettingsType } from '../../../../services/settingsApi';

// Hooks
import { useTaggerSettings } from './hooks/useTaggerSettings';
import { useTaggerModels } from './hooks/useTaggerModels';
import { useTaggerTest } from './hooks/useTaggerTest';
import { useTaggerBatch } from './hooks/useTaggerBatch';

// Components
import { TaggerModelStatus } from './components/TaggerModelStatus';
import { TaggerConfigForm } from './components/TaggerConfigForm';
import { TaggerMemoryManagement } from './components/TaggerMemoryManagement';
import { TaggerTestSection } from './components/TaggerTestSection';
import { TaggerBatchOperations } from './components/TaggerBatchOperations';

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

  // Test hook
  const {
    testImageId,
    testProcessing,
    testResult,
    setTestImageId,
    handleTestImage,
  } = useTaggerTest();

  // Batch hook
  const {
    batchProcessing,
    handleResetAutoTags,
  } = useTaggerBatch();

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
          <Stack spacing={2} sx={{ mt: 2 }}>
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
            />

            <Divider sx={{ my: 3 }} />

            {/* Memory Management Settings */}
            {localSettings.enabled && (
              <TaggerMemoryManagement
                localSettings={localSettings}
                onUpdateSettings={updateSettings}
              />
            )}

            <Divider sx={{ my: 3 }} />

            {/* Batch Operations */}
            {localSettings.enabled && (
              <TaggerBatchOperations
                batchProcessing={batchProcessing}
                onResetAutoTags={() => handleResetAutoTags(t)}
              />
            )}

            <Divider sx={{ my: 3 }} />

            {/* Python Path & Dependency Check */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
                <Typography variant="subtitle1">
                  {t('tagger.pythonPath.label')}
                </Typography>
                <InfoTooltip title={t('tagger.pythonPath.helper')} />
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  value={localSettings.pythonPath}
                  onChange={(e) => updateSettings({ pythonPath: e.target.value })}
                  fullWidth
                  disabled={!localSettings.enabled}
                  placeholder="python"
                />
                <Button
                  variant="outlined"
                  startIcon={checking ? <CircularProgress size={20} /> : <CheckCircleIcon />}
                  onClick={handleCheckDeps}
                  disabled={checking || !localSettings.enabled}
                  sx={{ minWidth: { sm: '200px' }, whiteSpace: 'nowrap' }}
                >
                  {checking ? t('tagger.buttons.checking') : t('tagger.buttons.checkDependencies')}
                </Button>
              </Stack>

              {dependencyStatus && (
                <Alert severity={dependencyAvailable ? 'success' : 'error'} sx={{ mt: 2 }}>
                  {dependencyStatus}
                </Alert>
              )}
            </Box>

            <Divider sx={{ my: 3 }} />

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
