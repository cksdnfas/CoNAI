import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  CircularProgress,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
} from '@mui/material';
import {
  Search as SearchIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../../../types/image';
import type { SimilarImage } from '../../../../../services/similarityApi';
import { SimilarityResultsDisplay } from './SimilarityResultsDisplay';

interface SimilarityTestPanelProps {
  testImageId: string;
  testLoading: boolean;
  testType: 'duplicates' | 'similar' | 'color';
  queryImage: ImageRecord | null;
  testResults: SimilarImage[];
  onSetTestImageId: (id: string) => void;
  onSetTestType: (type: 'duplicates' | 'similar' | 'color') => void;
  onTestSearch: () => void;
}

export const SimilarityTestPanel: React.FC<SimilarityTestPanelProps> = ({
  testImageId,
  testLoading,
  testType,
  queryImage,
  testResults,
  onSetTestImageId,
  onSetTestType,
  onTestSearch,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t('similarity.test.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('similarity.test.description')}
        </Typography>

        <Stack spacing={2}>
          <Stack direction="row" spacing={2} alignItems="flex-end">
            <TextField
              label={t('similarity.test.imageId')}
              value={testImageId}
              onChange={(e) => onSetTestImageId(e.target.value)}
              type="number"
              placeholder={t('similarity.test.placeholder')}
              fullWidth
            />
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel>{t('similarity.test.searchType')}</InputLabel>
              <Select
                value={testType}
                label={t('similarity.test.searchType')}
                onChange={(e) => onSetTestType(e.target.value as any)}
              >
                <MenuItem value="duplicates">{t('similarity.test.types.duplicates')}</MenuItem>
                <MenuItem value="similar">{t('similarity.test.types.similar')}</MenuItem>
                <MenuItem value="color">{t('similarity.test.types.color')}</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              startIcon={testLoading ? <CircularProgress size={20} /> : <SearchIcon />}
              onClick={onTestSearch}
              disabled={testLoading || !testImageId}
              fullWidth
            >
              {testLoading ? t('similarity.test.searching') : t('similarity.test.searchButton')}
            </Button>
          </Stack>

          {/* Results Display */}
          {queryImage && (
            <SimilarityResultsDisplay
              queryImage={queryImage}
              testResults={testResults}
            />
          )}

          {testResults.length === 0 && testImageId && !testLoading && (
            <Alert severity="info">
              {t('similarity.test.noResults')}
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};
