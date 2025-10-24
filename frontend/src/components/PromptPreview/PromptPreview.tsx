import React, { useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Alert,
  CircularProgress,
  Stack
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ImageIcon from '@mui/icons-material/Image';
import { useTranslation } from 'react-i18next';
import { extractMetadata, type ParsedMetadata } from '../../utils/metadataReader';
import { parsePrompt, parsePromptWithLoRAs } from '@comfyui-image-manager/shared';

const PromptPreview: React.FC = () => {
  const { t } = useTranslation(['upload', 'common']);
  const [metadata, setMetadata] = useState<ParsedMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError(t('upload:promptPreview.invalidFileType'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const extracted = await extractMetadata(file);
      setMetadata(extracted);
    } catch (err) {
      console.error('Failed to extract metadata:', err);
      setError(t('upload:promptPreview.extractionFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  }, [handleFile]);

  // Parse prompt with shared utilities
  const parsedPrompt = metadata?.positivePrompt
    ? parsePrompt(metadata.positivePrompt)
    : null;

  const parsedNegative = metadata?.negativePrompt
    ? parsePrompt(metadata.negativePrompt)
    : null;

  const loraInfo = metadata?.positivePrompt
    ? parsePromptWithLoRAs(metadata.positivePrompt)
    : null;

  return (
    <Paper
      elevation={1}
      sx={{
        p: { xs: 2, sm: 3 },
        mt: { xs: 3, sm: 4 },
        borderRadius: 2,
      }}
    >
      <Typography
        variant="h6"
        gutterBottom
        sx={{
          fontSize: { xs: '1.1rem', sm: '1.25rem' },
          fontWeight: 600,
        }}
      >
        {t('upload:promptPreview.title')}
      </Typography>

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: 2 }}
      >
        {t('upload:promptPreview.description')}
      </Typography>

      {/* Dropzone */}
      <Box
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        sx={{
          border: '2px dashed',
          borderColor: dragActive ? 'primary.main' : 'grey.300',
          borderRadius: 2,
          p: 3,
          textAlign: 'center',
          backgroundColor: dragActive ? 'action.hover' : 'background.default',
          cursor: 'pointer',
          transition: 'all 0.2s',
          '&:hover': {
            borderColor: 'primary.main',
            backgroundColor: 'action.hover'
          }
        }}
        onClick={() => document.getElementById('prompt-preview-input')?.click()}
      >
        <input
          id="prompt-preview-input"
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
        <ImageIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
        <Typography variant="body1" color="text.secondary">
          {dragActive
            ? t('upload:promptPreview.dropHere')
            : t('upload:promptPreview.dragOrClick')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('upload:promptPreview.noUpload')}
        </Typography>
      </Box>

      {/* Loading */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 3 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {/* Metadata Display */}
      {metadata && !loading && (
        <Box sx={{ mt: 3 }}>
          {/* AI Tool */}
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              {t('upload:promptPreview.aiTool')}
            </Typography>
            <Chip
              label={metadata.aiTool || 'Unknown'}
              color={metadata.aiTool !== 'Unknown' ? 'primary' : 'default'}
              size="small"
            />
          </Box>

          {/* Positive Prompt */}
          {parsedPrompt && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {t('upload:promptPreview.positivePrompt')}
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  backgroundColor: 'background.default',
                  maxHeight: 200,
                  overflow: 'auto'
                }}
              >
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {parsedPrompt.cleaned}
                </Typography>
              </Paper>
              {parsedPrompt.terms.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t('upload:promptPreview.terms')} ({parsedPrompt.terms.length})
                  </Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                    {parsedPrompt.terms.slice(0, 20).map((term: string, idx: number) => (
                      <Chip
                        key={idx}
                        label={term}
                        size="small"
                        variant="outlined"
                        sx={{ mb: 0.5 }}
                      />
                    ))}
                    {parsedPrompt.terms.length > 20 && (
                      <Chip
                        label={`+${parsedPrompt.terms.length - 20} more`}
                        size="small"
                        variant="outlined"
                        sx={{ mb: 0.5 }}
                      />
                    )}
                  </Stack>
                </Box>
              )}
            </Box>
          )}

          {/* Negative Prompt */}
          {parsedNegative && parsedNegative.cleaned && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {t('upload:promptPreview.negativePrompt')}
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  backgroundColor: 'background.default',
                  maxHeight: 150,
                  overflow: 'auto'
                }}
              >
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {parsedNegative.cleaned}
                </Typography>
              </Paper>
            </Box>
          )}

          {/* LoRA Models */}
          {loraInfo && loraInfo.loras.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {t('upload:promptPreview.loraModels')} ({loraInfo.loras.length})
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap">
                {loraInfo.loras.map((lora: string, idx: number) => (
                  <Chip
                    key={idx}
                    label={lora}
                    size="small"
                    color="secondary"
                    sx={{ mb: 0.5 }}
                  />
                ))}
              </Stack>
            </Box>
          )}

          {/* Parameters */}
          {metadata.parameters && Object.keys(metadata.parameters).length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {t('upload:promptPreview.parameters')}
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  backgroundColor: 'background.default'
                }}
              >
                <Stack spacing={0.5}>
                  {Object.entries(metadata.parameters)
                    .filter(([_, value]) => value !== undefined && value !== null)
                    .map(([key, value]) => (
                      <Typography key={key} variant="body2">
                        <strong>{key}:</strong> {String(value)}
                      </Typography>
                    ))}
                </Stack>
              </Paper>
            </Box>
          )}

          {/* Raw Metadata - Collapsible */}
          <Accordion sx={{ mt: 2 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2">
                {t('upload:promptPreview.rawMetadata')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  backgroundColor: 'background.default',
                  maxHeight: 400,
                  overflow: 'auto'
                }}
              >
                <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(metadata.rawMetadata, null, 2)}
                </pre>
              </Paper>
            </AccordionDetails>
          </Accordion>
        </Box>
      )}
    </Paper>
  );
};

export default PromptPreview;
