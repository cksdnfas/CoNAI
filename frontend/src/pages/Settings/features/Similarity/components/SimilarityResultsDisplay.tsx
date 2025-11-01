import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Stack,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../../../types/image';
import type { SimilarImage } from '../../../../../services/similarityApi';
import { getThumbnailUrl, getMatchTypeColor, getMatchTypeLabel } from '../utils/similarityHelpers';
import ImageViewerModal from '../../../../../components/ImageViewerModal/ImageViewerModal';

interface SimilarityResultsDisplayProps {
  queryImage: ImageRecord;
  testResults: SimilarImage[];
}

export const SimilarityResultsDisplay: React.FC<SimilarityResultsDisplayProps> = ({
  queryImage,
  testResults,
}) => {
  const { t } = useTranslation('settings');
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <Box>
      {/* Query Image */}
      <Typography variant="subtitle2" gutterBottom>
        {t('similarity.test.queryImage')}
      </Typography>
      <Card variant="outlined" sx={{ maxWidth: 400, mx: 'auto', mb: 3 }}>
        {getThumbnailUrl(queryImage) ? (
          <Box
            component="img"
            src={getThumbnailUrl(queryImage)!}
            alt={queryImage.original_file_path ?? ''}
            sx={{
              width: '100%',
              maxHeight: 300,
              objectFit: 'contain',
            }}
          />
        ) : (
          <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100' }}>
            <Typography color="text.secondary">No thumbnail available</Typography>
          </Box>
        )}
        <CardContent>
          <Typography variant="body2">
            <strong>{t('similarity.test.imageDetails.id')}</strong> {queryImage.composite_hash}
          </Typography>
          <Typography variant="body2" noWrap>
            <strong>{t('similarity.test.imageDetails.filename')}</strong> {queryImage.original_file_path ?? ''}
          </Typography>
          <Typography variant="body2">
            <strong>{t('similarity.test.imageDetails.size')}</strong> {queryImage.width} × {queryImage.height}
          </Typography>
          {queryImage.ai_tool && (
            <Typography variant="body2">
              <strong>{t('similarity.test.imageDetails.aiTool')}</strong> {queryImage.ai_tool}
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Search Results */}
      {testResults.length > 0 && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {t('similarity.test.results', { count: testResults.length })}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
            {testResults.slice(0, 12).map((result, index) => (
              <Box key={result.image.file_id ? `file-${result.image.file_id}` : `hash-${result.image.composite_hash}-${index}`}>
                <Card
                  variant="outlined"
                  onClick={() => {
                    setSelectedImage(result.image);
                    setSelectedIndex(index);
                  }}
                  sx={{
                    cursor: 'pointer',
                    transition: 'all 0.2s ease-in-out',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: 4,
                    },
                  }}
                >
                  {getThumbnailUrl(result.image) ? (
                    <Box
                      component="img"
                      src={getThumbnailUrl(result.image)!}
                      alt={result.image.original_file_path ?? ''}
                      sx={{
                        width: '100%',
                        height: 150,
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <Box sx={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100' }}>
                      <Typography variant="caption" color="text.secondary">No image</Typography>
                    </Box>
                  )}
                  <CardContent sx={{ p: 1 }}>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        label={t('similarity.test.similarity', { percent: result.similarity.toFixed(1) })}
                        size="small"
                        color="primary"
                      />
                      <Chip
                        label={getMatchTypeLabel(result.matchType, t)}
                        size="small"
                        color={getMatchTypeColor(result.matchType)}
                      />
                    </Stack>
                    {result.colorSimilarity && (
                      <Typography variant="caption" color="text.secondary">
                        {t('similarity.test.colorSimilarity', { percent: result.colorSimilarity.toFixed(1) })}
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Image Viewer Modal */}
      <ImageViewerModal
        open={selectedImage !== null}
        onClose={() => setSelectedImage(null)}
        image={selectedImage}
        images={testResults.map(r => r.image)}
        currentIndex={selectedIndex}
        onImageChange={setSelectedIndex}
      />
    </Box>
  );
};
