import { type ReactElement } from 'react'
import { Category as CategoryIcon,
Folder as FolderIcon,
Image as ImageIcon,
Save as SaveIcon,
TextFields as TextIcon,
Tune as TuneIcon, } from '@/features/workflows/utils/workflow-icons'

export function getNodeColor(classType: string): string {
  if (classType.includes('Loader') || classType.includes('Load')) return '#4CAF50'
  if (classType.includes('Sampler')) return '#2196F3'
  if (classType.includes('Text') || classType.includes('CLIP')) return '#FF9800'
  if (classType.includes('VAE') || classType.includes('Decode') || classType.includes('Encode')) return '#9C27B0'
  if (classType.includes('Save') || classType.includes('Output')) return '#F44336'
  if (classType.includes('Latent')) return '#00BCD4'
  if (classType.includes('Image')) return '#673AB7'
  return '#757575'
}

export function getNodeIcon(classType: string): ReactElement {
  if (classType.includes('Loader') || classType.includes('Load')) return <FolderIcon fontSize="small" />
  if (classType.includes('Sampler')) return <TuneIcon fontSize="small" />
  if (classType.includes('Text') || classType.includes('CLIP')) return <TextIcon fontSize="small" />
  if (classType.includes('Save') || classType.includes('Output')) return <SaveIcon fontSize="small" />
  if (classType.includes('Image') || classType.includes('Latent')) return <ImageIcon fontSize="small" />
  return <CategoryIcon fontSize="small" />
}
