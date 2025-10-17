import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { useTranslation } from 'react-i18next';
import UploadZone from '../../components/UploadZone/UploadZone';

const UploadPage: React.FC = () => {
  const { t } = useTranslation(['upload', 'common']);

  const handleUploadComplete = () => {
    // 업로드 완료 후 필요한 작업 (예: 갤러리 페이지로 이동)
    console.log('Upload completed');
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Typography
        variant="h4"
        component="h1"
        gutterBottom
        sx={{
          fontSize: { xs: '1.75rem', sm: '2rem', md: '2.25rem' },
          fontWeight: 600,
        }}
      >
        {t('upload:page.title')}
      </Typography>
      <Typography
        variant="body1"
        color="text.secondary"
        sx={{
          mb: { xs: 3, sm: 4 },
          fontSize: { xs: '0.875rem', sm: '1rem' },
        }}
      >
        {t('upload:page.description')}
      </Typography>

      <UploadZone onUploadComplete={handleUploadComplete} />

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
          {t('upload:guide.title')}
        </Typography>
        <Box component="ul" sx={{ pl: { xs: 2, sm: 2 }, m: 0 }}>
          <Typography
            component="li"
            variant="body2"
            sx={{
              mb: 1,
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
              lineHeight: 1.5,
            }}
          >
            {t('upload:guide.metadataExtraction')}
          </Typography>
          <Typography
            component="li"
            variant="body2"
            sx={{
              mb: 1,
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
              lineHeight: 1.5,
            }}
          >
            {t('upload:guide.videoProcessing')}
          </Typography>
          <Typography
            component="li"
            variant="body2"
            sx={{
              mb: 1,
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
              lineHeight: 1.5,
            }}
          >
            {t('upload:guide.dataAnalysis')}
          </Typography>
          <Typography
            component="li"
            variant="body2"
            sx={{
              mb: 1,
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
              lineHeight: 1.5,
            }}
          >
            {t('upload:guide.imageVersions')}
          </Typography>
          <Typography
            component="li"
            variant="body2"
            sx={{
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
              lineHeight: 1.5,
            }}
          >
            {t('upload:guide.autoGrouping')}
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
};

export default UploadPage;