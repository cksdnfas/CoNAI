import { useState } from 'react';
import {
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Chip,
  Paper,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  ContentCopy as CopyIcon,
  Lightbulb as TipIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface NAIPromptHelperProps {
  onPromptAdd: (text: string) => void;
  onPromptReplace: (text: string) => void;
}

const PROMPT_EXAMPLES = {
  characters: [
    '1girl',
    '1boy',
    'solo',
    'multiple girls',
    'detailed face',
    'beautiful eyes',
    'long hair',
    'short hair'
  ],
  styles: [
    'anime style',
    'realistic',
    'portrait',
    'full body',
    'upper body',
    'close-up',
    'masterpiece',
    'high resolution'
  ],
  environments: [
    'outdoor',
    'indoor',
    'city',
    'nature',
    'fantasy world',
    'modern',
    'traditional',
    'cyberpunk'
  ],
  lighting: [
    'natural lighting',
    'studio lighting',
    'dramatic lighting',
    'soft lighting',
    'volumetric lighting',
    'backlighting',
    'golden hour',
    'night'
  ]
};

const EXAMPLE_PROMPTS = [
  {
    name: 'Anime Portrait',
    prompt: '1girl, solo, portrait, detailed face, beautiful eyes, long hair, anime style, masterpiece, best quality'
  },
  {
    name: 'Realistic Character',
    prompt: 'realistic, 1girl, detailed face, natural lighting, high resolution, professional photography'
  },
  {
    name: 'Fantasy Scene',
    prompt: 'fantasy world, 1girl, magical atmosphere, dramatic lighting, detailed background, masterpiece'
  },
  {
    name: 'Urban Setting',
    prompt: '1girl, city, cyberpunk, neon lights, modern, detailed, high quality'
  }
];

export default function NAIPromptHelper({ onPromptAdd, onPromptReplace }: NAIPromptHelperProps) {
  const { t } = useTranslation(['imageGeneration']);
  const [expanded, setExpanded] = useState<string | false>(false);

  const handleChange = (panel: string) => (_event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  const handleCopyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
  };

  return (
    <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <TipIcon color="primary" />
        <Typography variant="h6">{t('imageGeneration:nai.promptHelper.title')}</Typography>
      </Box>

      {/* Example Prompts */}
      <Accordion expanded={expanded === 'examples'} onChange={handleChange('examples')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography>{t('imageGeneration:nai.promptHelper.examples')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {EXAMPLE_PROMPTS.map((example, index) => (
              <Paper key={index} sx={{ p: 2 }} variant="outlined">
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight="bold">
                    {example.name}
                  </Typography>
                  <Box>
                    <Tooltip title={t('imageGeneration:nai.promptHelper.copy')}>
                      <IconButton size="small" onClick={() => handleCopyPrompt(example.prompt)}>
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('imageGeneration:nai.promptHelper.use')}>
                      <IconButton size="small" onClick={() => onPromptReplace(example.prompt)}>
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {example.prompt}
                </Typography>
              </Paper>
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Tag Categories */}
      <Accordion expanded={expanded === 'characters'} onChange={handleChange('characters')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography>{t('imageGeneration:nai.promptHelper.characters')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {PROMPT_EXAMPLES.characters.map((tag, index) => (
              <Chip
                key={index}
                label={tag}
                onClick={() => onPromptAdd(tag)}
                color="primary"
                variant="outlined"
              />
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>

      <Accordion expanded={expanded === 'styles'} onChange={handleChange('styles')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography>{t('imageGeneration:nai.promptHelper.styles')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {PROMPT_EXAMPLES.styles.map((tag, index) => (
              <Chip
                key={index}
                label={tag}
                onClick={() => onPromptAdd(tag)}
                color="secondary"
                variant="outlined"
              />
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>

      <Accordion expanded={expanded === 'environments'} onChange={handleChange('environments')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography>{t('imageGeneration:nai.promptHelper.environments')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {PROMPT_EXAMPLES.environments.map((tag, index) => (
              <Chip
                key={index}
                label={tag}
                onClick={() => onPromptAdd(tag)}
                color="success"
                variant="outlined"
              />
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>

      <Accordion expanded={expanded === 'lighting'} onChange={handleChange('lighting')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography>{t('imageGeneration:nai.promptHelper.lighting')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {PROMPT_EXAMPLES.lighting.map((tag, index) => (
              <Chip
                key={index}
                label={tag}
                onClick={() => onPromptAdd(tag)}
                color="warning"
                variant="outlined"
              />
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}
