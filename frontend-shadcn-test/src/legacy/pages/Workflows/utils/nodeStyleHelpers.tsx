/**
 * ComfyUI Node 스타일 유틸리티
 * CustomNode와 EnhancedCustomNode에서 공통으로 사용하는 색상 및 아이콘 헬퍼
 */

import React from 'react';
import {
  Category as CategoryIcon,
  Image as ImageIcon,
  Tune as TuneIcon,
  TextFields as TextIcon,
  Save as SaveIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';

/**
 * ComfyUI 노드 타입에 따른 색상 반환
 * @param classType - ComfyUI node class type (예: 'CheckpointLoaderSimple', 'KSampler')
 * @returns Material Design 색상 코드
 */
export function getNodeColor(classType: string): string {
  if (classType.includes('Loader') || classType.includes('Load')) {
    return '#4CAF50'; // Green for loaders
  } else if (classType.includes('Sampler')) {
    return '#2196F3'; // Blue for samplers
  } else if (classType.includes('Text') || classType.includes('CLIP')) {
    return '#FF9800'; // Orange for text/CLIP
  } else if (classType.includes('VAE') || classType.includes('Decode') || classType.includes('Encode')) {
    return '#9C27B0'; // Purple for VAE
  } else if (classType.includes('Save') || classType.includes('Output')) {
    return '#F44336'; // Red for output
  } else if (classType.includes('Latent')) {
    return '#00BCD4'; // Cyan for latent
  } else if (classType.includes('Image')) {
    return '#673AB7'; // Deep purple for image processing
  }

  return '#757575'; // Gray for unknown types
}

/**
 * ComfyUI 노드 타입에 따른 아이콘 반환
 * @param classType - ComfyUI node class type
 * @returns Material-UI Icon 컴포넌트
 */
export function getNodeIcon(classType: string): React.ReactElement {
  if (classType.includes('Loader') || classType.includes('Load')) {
    return <FolderIcon fontSize="small" />;
  } else if (classType.includes('Sampler')) {
    return <TuneIcon fontSize="small" />;
  } else if (classType.includes('Text') || classType.includes('CLIP')) {
    return <TextIcon fontSize="small" />;
  } else if (classType.includes('Save') || classType.includes('Output')) {
    return <SaveIcon fontSize="small" />;
  } else if (classType.includes('Image') || classType.includes('Latent')) {
    return <ImageIcon fontSize="small" />;
  }

  return <CategoryIcon fontSize="small" />;
}

/**
 * 노드 타입 카테고리 분류
 * @param classType - ComfyUI node class type
 * @returns 노드 카테고리 ('loader', 'sampler', 'text', 'vae', 'output', 'latent', 'image', 'other')
 */
export function getNodeCategory(classType: string): string {
  if (classType.includes('Loader') || classType.includes('Load')) {
    return 'loader';
  } else if (classType.includes('Sampler')) {
    return 'sampler';
  } else if (classType.includes('Text') || classType.includes('CLIP')) {
    return 'text';
  } else if (classType.includes('VAE') || classType.includes('Decode') || classType.includes('Encode')) {
    return 'vae';
  } else if (classType.includes('Save') || classType.includes('Output')) {
    return 'output';
  } else if (classType.includes('Latent')) {
    return 'latent';
  } else if (classType.includes('Image')) {
    return 'image';
  }

  return 'other';
}
