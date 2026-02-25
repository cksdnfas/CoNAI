import { Box, Typography, Paper, Alert, Divider, Chip, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { Info as InfoIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export function MarkedFieldsGuide() {
  const { t } = useTranslation('workflows');

  return (
    <Paper sx={{ mb: 3 }}>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InfoIcon color="info" />
            <Typography variant="h6">
              {t('markedFields.guideTitle')}
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Divider sx={{ mb: 2 }} />

      <Typography variant="body1" gutterBottom>
        <strong>{t('markedFields.whatIs')}</strong>
      </Typography>
      <Typography variant="body2" paragraph>
        {t('markedFields.whatIsDesc')}
      </Typography>

      <Typography variant="body1" gutterBottom sx={{ mt: 2 }}>
        <strong>{t('markedFields.howToFind')}</strong>
      </Typography>
      <Box component="ol" sx={{ pl: 2, '& li': { mb: 1 } }}>
        <li>
          <Typography variant="body2">
            {t('markedFields.step1')}
          </Typography>
        </li>
        <li>
          <Typography variant="body2">
            {t('markedFields.step2')}
          </Typography>
        </li>
        <li>
          <Typography variant="body2">
            {t('markedFields.step3')}
          </Typography>
        </li>
      </Box>

      <Alert severity="success" sx={{ mt: 2 }}>
        <Typography variant="body2" component="div">
          <strong>{t('markedFields.exampleTitle')}</strong>
          <br /><br />

          <strong>{t('markedFields.example1Title')}</strong>
          <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
            <li><strong>{t('markedFields.example1FieldId')}</strong></li>
            <li><strong>{t('markedFields.example1Label')}</strong></li>
            <li><strong>{t('markedFields.example1Type')}</strong></li>
            <li><strong>{t('markedFields.example1Path')}</strong></li>
            <li><strong>{t('markedFields.example1Default')}</strong></li>
          </ul>
          <br />

          <strong>{t('markedFields.example2Title')}</strong>
          <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
            <li><strong>{t('markedFields.example2FieldId')}</strong></li>
            <li><strong>{t('markedFields.example2Label')}</strong></li>
            <li><strong>{t('markedFields.example2Type')}</strong></li>
            <li><strong>{t('markedFields.example2Path')}</strong></li>
            <li><strong>{t('markedFields.example2Default')}</strong></li>
          </ul>
          <br />

          <strong>{t('markedFields.example3Title')}</strong>
          <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
            <li><strong>{t('markedFields.example3FieldId')}</strong></li>
            <li><strong>{t('markedFields.example3Label')}</strong></li>
            <li><strong>{t('markedFields.example3Type')}</strong></li>
            <li><strong>{t('markedFields.example3Path')}</strong></li>
            <li><strong>{t('markedFields.example3Default')}</strong></li>
            <li><strong>{t('markedFields.example3Min')}</strong></li>
            <li><strong>{t('markedFields.example3Max')}</strong></li>
          </ul>
          <br />

          <strong>{t('markedFields.example4Title')}</strong>
          <ul style={{ marginLeft: '20px', marginTop: '8px' }}>
            <li><strong>{t('markedFields.example4FieldId')}</strong></li>
            <li><strong>{t('markedFields.example4Label')}</strong></li>
            <li><strong>{t('markedFields.example4Type')}</strong></li>
            <li><strong>{t('markedFields.example4Path')}</strong></li>
            <li><strong>{t('markedFields.example4Options')}</strong></li>
          </ul>
        </Typography>
      </Alert>

      <Alert severity="info" sx={{ mt: 2 }}>
        <Typography variant="body2">
          <strong>{t('markedFields.tipTitle')}</strong> {t('markedFields.tipDesc')}
        </Typography>
      </Alert>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}
