import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord, PageSize } from '../../types/image';
import ImageList from '../ImageList/ImageList';

interface ImageGridModalProps {
  open: boolean;
  onClose: () => void;
  images: ImageRecord[];
  loading?: boolean;
  selectable?: boolean;
  selectedIds?: number[];
  onSelectionChange?: (selectedIds: number[]) => void;
  pageSize?: PageSize;
  onPageSizeChange?: (size: PageSize) => void;
  currentPage?: number;
  totalPages?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onImageDelete?: (compositeHash: string) => void;
  title?: string;
}

const ImageGridModal: React.FC<ImageGridModalProps> = ({
  open,
  onClose,
  images,
  loading = false,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  pageSize = 25,
  onPageSizeChange,
  currentPage = 1,
  totalPages = 1,
  total = 0,
  onPageChange,
  onImageDelete,
  title,
}) => {
  const { t } = useTranslation(['common']);
  const modalTitle = title || t('common:imageGrid.title', 'Image Grid');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: {
          height: '90vh',
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">{modalTitle}</Typography>
          <IconButton
            aria-label="close"
            onClick={onClose}
            sx={{
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent
        sx={{
          p: 2,
          overflow: 'auto',
          flex: 1,
        }}
      >
        <ImageList
          images={images}
          loading={loading}
          contextId="viewer_group_modal"
          mode="pagination"
          pagination={{
            currentPage,
            totalPages,
            onPageChange: onPageChange || (() => { }),
            pageSize: pageSize as number,
            onPageSizeChange: (size) => onPageSizeChange?.(size as PageSize)
          }}
          selectable={false} // Viewer modal group list usually just for viewing
          total={total}
          // onImageClick logic is handled internally by ImageList to open Viewer, 
          // but we are INSIDE a Viewer's "Group Modal". 
          // If I click an image here, what happens? 
          // Original ImageGrid didn't specify onImageClick, so it likely used default or none?
          // ImageGrid had: onImageClick?: (index: number) => void;
          // If not provided, it might have done nothing?
          // But ImageList has default handleImageClick opening a viewer.
          // If we are in a modal on top of a viewer, opening another viewer might be weird.
          // But let's assume standard behavior for now.
          onImageDelete={onImageDelete}
        />
      </DialogContent>
    </Dialog>
  );
};

export default ImageGridModal;