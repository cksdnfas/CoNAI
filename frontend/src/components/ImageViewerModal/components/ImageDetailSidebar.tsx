import React, { useState } from 'react';
import { Box, Typography, IconButton, Tooltip, Snackbar, Alert } from '@mui/material';
import { ContentCopy as CopyIcon, HourglassEmpty as WaitingIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../types/image';
import PromptDisplay from '../../PromptDisplay';
import { FileInfoSection } from './FileInfoSection';
import { GroupInfoSection } from './GroupInfoSection';
import { AIInfoSection } from './AIInfoSection';

type ImageGroupInfo = NonNullable<ImageRecord['groups']>[number];

interface ImageDetailSidebarProps {
  image: ImageRecord;
  onGroupClick: (group: ImageGroupInfo) => void;
  isTaggerEnabled?: boolean;
  onAutoTagGenerated?: () => void;
  isHistoryContext?: boolean;
}

/**
 * Sidebar containing all image detail information sections
 */
export const ImageDetailSidebar: React.FC<ImageDetailSidebarProps> = ({
  image,
  onGroupClick,
  isTaggerEnabled = false,
  onAutoTagGenerated,
  isHistoryContext = false,
}) => {
  const { t } = useTranslation(['imageDetail', 'common']);
  const [copySnackbarOpen, setCopySnackbarOpen] = useState(false);

  // 프롬프트 표시 여부 결정
  const hasPrompts = image.ai_metadata &&
                     (image.ai_metadata.prompts.prompt || image.ai_metadata.prompts.negative_prompt);

  // auto_tags가 있는 경우에도 프롬프트 섹션 표시
  const hasAutoTags = image.auto_tags && Object.keys(image.auto_tags).length > 0;
  const shouldShowPromptSection = hasPrompts || isTaggerEnabled || hasAutoTags;

  // Handle hash copy
  const handleCopyHash = async () => {
    if (image.composite_hash) {
      try {
        await navigator.clipboard.writeText(image.composite_hash);
        setCopySnackbarOpen(true);
      } catch (err) {
        console.error('Failed to copy hash:', err);
      }
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top info section - scrollable */}
      <Box sx={{ flexShrink: 0, overflowY: 'auto', mb: 2 }}>
        <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
          {t('imageDetail:info.title')}
        </Typography>

        {/* Hash display section */}
        <Box
          sx={{
            mb: 2,
            p: 1.5,
            bgcolor: 'action.hover',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          {image.composite_hash ? (
            <>
              <Tooltip title={t('common:clickToCopy')}>
                <Box
                  onClick={handleCopyHash}
                  sx={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    color: 'text.secondary',
                    '&:hover': {
                      color: 'primary.main',
                    },
                  }}
                >
                  {image.composite_hash}
                </Box>
              </Tooltip>
              <Tooltip title={t('imageDetail:copyHash')}>
                <IconButton
                  size="small"
                  onClick={handleCopyHash}
                  sx={{ flexShrink: 0 }}
                >
                  <CopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <>
              <WaitingIcon fontSize="small" color="disabled" />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontStyle: 'italic' }}
              >
                {t('imageDetail:hashGenerating')}
              </Typography>
            </>
          )}
        </Box>

        <FileInfoSection image={image} />
        <GroupInfoSection groups={image.groups} onGroupClick={onGroupClick} />
        <AIInfoSection image={image} />
      </Box>

      {/* Prompt section - takes remaining space */}
      {shouldShowPromptSection && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <PromptDisplay
            prompt={image.ai_metadata?.prompts.prompt}
            negativePrompt={image.ai_metadata?.prompts.negative_prompt}
            variant="outlined"
            showGrouped={true}
            imageId={image.composite_hash || undefined}
            autoTags={image.auto_tags}
            isTaggerEnabled={isTaggerEnabled}
            onAutoTagGenerated={onAutoTagGenerated}
            isHistoryContext={isHistoryContext}
          />
        </Box>
      )}

      {/* Copy success snackbar */}
      <Snackbar
        open={copySnackbarOpen}
        autoHideDuration={2000}
        onClose={() => setCopySnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setCopySnackbarOpen(false)} severity="success" variant="filled">
          {t('imageDetail:hashCopied')}
        </Alert>
      </Snackbar>
    </Box>
  );
};
