import React from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Stack,
} from '@mui/material';
import {
  Science as ScienceIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface TaggerTestSectionProps {
  testImageId: string;
  testProcessing: boolean;
  testResult: any;
  onSetTestImageId: (id: string) => void;
  onTestImage: () => void;
}

export const TaggerTestSection: React.FC<TaggerTestSectionProps> = ({
  testImageId,
  testProcessing,
  testResult,
  onSetTestImageId,
  onTestImage,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t('tagger.test.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        {t('tagger.test.description')}
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          label={t('tagger.test.imageId')}
          value={testImageId}
          onChange={(e) => onSetTestImageId(e.target.value)}
          type="number"
          fullWidth
          placeholder={t('tagger.test.placeholder')}
        />
        <Button
          variant="contained"
          startIcon={testProcessing ? <CircularProgress size={20} /> : <ScienceIcon />}
          onClick={onTestImage}
          disabled={testProcessing || !testImageId}
          sx={{ minWidth: 150 }}
        >
          {testProcessing ? t('tagger.test.processing') : t('tagger.test.button')}
        </Button>
      </Stack>

      {testResult && (
        <Alert severity="success" sx={{ mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            {t('tagger.test.result')}
          </Typography>
          <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
            {JSON.stringify(testResult.auto_tags, null, 2)}
          </Typography>
        </Alert>
      )}
    </Box>
  );
};
