import React from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
} from '@mui/material';
import {
  Restore as RestoreIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface TaggerBatchOperationsProps {
  batchProcessing: boolean;
  onResetAutoTags: () => void;
}

export const TaggerBatchOperations: React.FC<TaggerBatchOperationsProps> = ({
  batchProcessing,
  onResetAutoTags,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t('tagger.batch.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        {t('tagger.batch.description')}
      </Typography>



      <Stack spacing={2}>
        {/* Reset Auto Tags Button */}
        <Button
          variant="outlined"
          color="error"
          startIcon={<RestoreIcon />}
          onClick={onResetAutoTags}
          disabled={batchProcessing}
          fullWidth
        >
          {t('tagger.batch.buttons.resetTags', 'Reset All Auto Tags')}
        </Button>
      </Stack>
    </Box>
  );
};
