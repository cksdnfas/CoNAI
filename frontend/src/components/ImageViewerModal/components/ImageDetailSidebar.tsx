import React from 'react';
import { Box, Typography } from '@mui/material';
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
}

/**
 * Sidebar containing all image detail information sections
 */
export const ImageDetailSidebar: React.FC<ImageDetailSidebarProps> = ({
  image,
  onGroupClick,
  isTaggerEnabled = false,
  onAutoTagGenerated,
}) => {
  const hasPrompts = image.ai_metadata &&
                     (image.ai_metadata.prompts.prompt || image.ai_metadata.prompts.negative_prompt);

  const shouldShowPromptSection = hasPrompts || isTaggerEnabled;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top info section - scrollable */}
      <Box sx={{ flexShrink: 0, overflowY: 'auto', mb: 2 }}>
        <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
          이미지 정보
        </Typography>

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
            imageId={image.id}
            autoTags={image.auto_tags}
            isTaggerEnabled={isTaggerEnabled}
            onAutoTagGenerated={onAutoTagGenerated}
          />
        </Box>
      )}
    </Box>
  );
};
