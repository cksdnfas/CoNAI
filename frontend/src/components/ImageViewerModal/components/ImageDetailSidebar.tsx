import React, { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import type { ImageRecord } from '../../../types/image';
import PromptDisplay from '../../PromptDisplay';
import { FileInfoSection } from './FileInfoSection';
import { GroupInfoSection } from './GroupInfoSection';
import { AIInfoSection } from './AIInfoSection';
import { imageApi } from '../../../services/api';

type ImageGroupInfo = NonNullable<ImageRecord['groups']>[number];

interface ImageDetailSidebarProps {
  image: ImageRecord;
  onGroupClick: (group: ImageGroupInfo) => void;
  isTaggerEnabled?: boolean;
  onAutoTagGenerated?: () => void;
  isHistoryContext?: boolean;
  linkedImageId?: number | null;
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
  linkedImageId,
}) => {
  const [linkedImage, setLinkedImage] = useState<ImageRecord | null>(null);
  const [loadingLinkedImage, setLoadingLinkedImage] = useState(false);

  // 히스토리 컨텍스트에서는 linked_image_id 조회를 비활성화
  // 히스토리 이미지는 항상 히스토리 폴더의 원본 프롬프트만 사용
  // (업로드된 이미지가 삭제될 수 있어서 404 에러 방지)
  useEffect(() => {
    // 히스토리 컨텍스트에서는 linked image 조회 안 함
    if (isHistoryContext) {
      setLinkedImage(null);
      return;
    }

    // 일반 컨텍스트에서만 linked_image_id 조회 (미래 확장성)
    if (linkedImageId) {
      const loadLinkedImage = async () => {
        try {
          setLoadingLinkedImage(true);
          const response = await imageApi.getImage(String(linkedImageId));
          if (response.success && response.data) {
            setLinkedImage(response.data);
          }
        } catch (error) {
          setLinkedImage(null);
        } finally {
          setLoadingLinkedImage(false);
        }
      };
      loadLinkedImage();
    } else {
      setLinkedImage(null);
    }
  }, [isHistoryContext, linkedImageId]);

  // 프롬프트 표시 여부 결정
  const hasPrompts = image.ai_metadata &&
                     (image.ai_metadata.prompts.prompt || image.ai_metadata.prompts.negative_prompt);

  // 히스토리 컨텍스트에서는 linked image의 AUTO 프롬프트 사용
  const showAutoPrompts = isHistoryContext && linkedImage && linkedImage.ai_metadata;

  const shouldShowPromptSection = hasPrompts || isTaggerEnabled || showAutoPrompts;

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
            imageId={image.composite_hash || undefined}
            autoTags={image.auto_tags}
            isTaggerEnabled={isTaggerEnabled}
            onAutoTagGenerated={onAutoTagGenerated}
            isHistoryContext={isHistoryContext}
            linkedImage={linkedImage}
            loadingLinkedImage={loadingLinkedImage}
          />
        </Box>
      )}
    </Box>
  );
};
