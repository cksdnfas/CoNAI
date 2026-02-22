import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  Dialog as ConfirmDialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  Alert,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  DriveFileMove as MoveIcon,
  Image as ImageIcon,
  PhotoLibrary as PhotoLibraryIcon,
  TextSnippet as TextSnippetIcon,
  Videocam as VideocamIcon,
} from '@mui/icons-material'
import type { GroupWithStats } from '@comfyui-image-manager/shared'
import type { ImageRecord, PageSize } from '@/types/image'
import ImageList from '../../../../legacy-src/components/ImageList/ImageList'
import GroupAssignModal from './group-assign-modal'
import { groupApi } from '@/services/group-api'
import { autoFolderGroupsApi } from '@/services/auto-folder-groups-api'
import { useImageListSettings } from '@/hooks/use-image-list-settings'
import LoraDatasetDialog from './lora-dataset-dialog'

interface GroupImageGridModalProps {
  open: boolean
  onClose: () => void
  images: ImageRecord[]
  loading?: boolean
  currentGroup: GroupWithStats | null
  allGroups: GroupWithStats[]
  pageSize?: PageSize
  onPageSizeChange?: (size: PageSize) => void
  currentPage?: number
  totalPages?: number
  total?: number
  onPageChange?: (page: number) => void
  infiniteScroll?: {
    hasMore: boolean
    loadMore: () => void
  }
  onImagesRemoved?: (selectedImageIds: string[]) => void
  onImagesAssigned?: (targetGroupId: number, selectedImageIds: string[]) => void
  readOnly?: boolean
  groupType?: 'custom' | 'auto-folder'
  onShowSnackbar?: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void
}

const GroupImageGridModal: React.FC<GroupImageGridModalProps> = ({
  open,
  onClose,
  images,
  loading = false,
  currentGroup,
  allGroups,
  pageSize = 25,
  onPageSizeChange,
  currentPage = 1,
  totalPages = 1,
  total = 0,
  onPageChange,
  infiniteScroll,
  readOnly = false,
  onImagesRemoved,
  onImagesAssigned,
  groupType = 'custom',
  onShowSnackbar,
}) => {
  const { t } = useTranslation(['imageGroups', 'common'])
  const { settings } = useImageListSettings('group_modal')
  const activeMode = settings.activeScrollMode || 'pagination'

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [downloadAnchorEl, setDownloadAnchorEl] = useState<null | HTMLElement>(null)
  const [downloadScope, setDownloadScope] = useState<'all' | 'selected'>('all')
  const [downloadConfirmOpen, setDownloadConfirmOpen] = useState(false)
  const [pendingDownloadType, setPendingDownloadType] = useState<'thumbnail' | 'original' | 'video' | null>(null)
  const [loraDialogOpen, setLoraDialogOpen] = useState(false)
  const [loraDialogScope, setLoraDialogScope] = useState<'all' | 'selected'>('all')

  void allGroups

  const { data: fileCountsResponse, isFetching: loadingCounts } = useQuery({
    queryKey: ['group-file-counts', groupType, currentGroup?.id, open],
    queryFn: async () => {
      if (!currentGroup?.id) {
        return { success: false }
      }
      return groupType === 'custom'
        ? groupApi.getFileCountsByType(currentGroup.id)
        : autoFolderGroupsApi.getFileCounts(currentGroup.id)
    },
    enabled: open && Boolean(currentGroup?.id),
  })

  const fileCounts = fileCountsResponse?.success && fileCountsResponse.data ? fileCountsResponse.data : null

  const selectedImages = images.filter((image) => image.id && selectedIds.includes(image.id))
  const hasManualSelected = selectedImages.some((image) => {
    const groupInfo = image.groups?.find((g) => g.id === currentGroup?.id)
    return groupInfo?.collection_type === 'manual'
  })
  const hasAutoSelected = selectedImages.some((image) => {
    const groupInfo = image.groups?.find((g) => g.id === currentGroup?.id)
    return groupInfo?.collection_type === 'auto'
  })

  const canRemove = hasManualSelected && !hasAutoSelected && selectedIds.length > 0
  const canAssign = selectedIds.length > 0

  const handleRemoveClick = () => {
    setRemoveDialogOpen(true)
  }

  const handleRemoveConfirm = () => {
    setRemoveDialogOpen(false)
    if (onImagesRemoved) {
      const manualImageIds = selectedImages
        .filter((image) => {
          const groupInfo = image.groups?.find((g) => g.id === currentGroup?.id)
          return groupInfo?.collection_type === 'manual'
        })
        .map((image) => image.composite_hash)
        .filter((hash): hash is string => hash !== null)
      onImagesRemoved(manualImageIds)
    }
    setSelectedIds([])
  }

  const handleAssignClick = () => {
    setAssignDialogOpen(true)
  }

  const handleAssignConfirm = async (groupId: number) => {
    if (!onImagesAssigned) return

    const compositeHashes = selectedImages
      .map((image) => image.composite_hash)
      .filter((hash): hash is string => hash !== null)
    onImagesAssigned(groupId, compositeHashes)
    setSelectedIds([])
  }

  const handleDownloadClick = (event: React.MouseEvent<HTMLElement>) => {
    setDownloadAnchorEl(event.currentTarget)
  }

  const handleDownloadMenuClose = () => {
    setDownloadAnchorEl(null)
  }

  const handleDownloadTypeSelect = (type: 'thumbnail' | 'original' | 'video', scope: 'all' | 'selected') => {
    handleDownloadMenuClose()
    if (!currentGroup?.id) return

    const count = scope === 'all' ? (fileCounts?.[type] || 0) : selectedIds.length
    if (count === 0) {
      const typeLabel = type === 'thumbnail' ? t('common:thumbnail') : type === 'original' ? t('common:original') : t('common:video')
      onShowSnackbar?.(`다운로드할 ${typeLabel} 파일이 없습니다.`, 'warning')
      return
    }

    if (count >= 100) {
      setPendingDownloadType(type)
      setDownloadScope(scope)
      setDownloadConfirmOpen(true)
    } else {
      void startDownload(type, scope)
    }
  }

  const startDownload = async (type: 'thumbnail' | 'original' | 'video', scope: 'all' | 'selected') => {
    if (!currentGroup?.id) return

    try {
      let compositeHashes: string[] | undefined
      if (scope === 'selected' && selectedIds.length > 0) {
        compositeHashes = selectedImages
          .map((image) => image.composite_hash)
          .filter((hash): hash is string => hash !== null)
      }

      if (groupType === 'custom') {
        await groupApi.downloadGroupBlob(currentGroup.id, type, compositeHashes)
      } else {
        await autoFolderGroupsApi.downloadGroup(currentGroup.id, type, compositeHashes)
      }

      onShowSnackbar?.('다운로드가 시작되었습니다.', 'success')
    } catch (error) {
      console.error('Download failed:', error)
      const message = error instanceof Error ? error.message : '다운로드에 실패했습니다.'
      onShowSnackbar?.(message, 'error')
    }
  }

  const handleDownloadConfirm = () => {
    if (pendingDownloadType) {
      void startDownload(pendingDownloadType, downloadScope)
    }
    setDownloadConfirmOpen(false)
    setPendingDownloadType(null)
  }

  const handleLoraDatasetDownload = async (captionMode: 'auto_tags' | 'merged') => {
    setLoraDialogOpen(false)
    if (!currentGroup?.id) return

    try {
      let compositeHashes: string[] | undefined
      if (loraDialogScope === 'selected' && selectedIds.length > 0) {
        compositeHashes = selectedImages
          .map((image) => image.composite_hash)
          .filter((hash): hash is string => hash !== null)
      }

      if (groupType === 'custom') {
        await groupApi.downloadGroupBlob(currentGroup.id, 'original', compositeHashes, captionMode)
      } else {
        await autoFolderGroupsApi.downloadGroup(currentGroup.id, 'original', compositeHashes, captionMode)
      }

      onShowSnackbar?.(t('imageGroups:download.loraDatasetStarted'), 'success')
    } catch (error) {
      console.error('LoRA dataset download failed:', error)
      const message = error instanceof Error ? error.message : '다운로드에 실패했습니다.'
      onShowSnackbar?.(message, 'error')
    }
  }

  const getSelectionMessage = () => {
    if (selectedIds.length === 0) return null

    if (hasManualSelected && hasAutoSelected) {
      return (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('imageGroups:imageModal.infoMixedSelection')}
        </Alert>
      )
    }

    if (hasAutoSelected && !hasManualSelected) {
      return (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('imageGroups:imageModal.warningAutoOnly')}
        </Alert>
      )
    }

    return null
  }

  return (
    <>
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
            <Typography variant="h6">
              {t('imageGroups:imageModal.title', { name: currentGroup?.name, count: total })}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <IconButton
                aria-label="download"
                onClick={handleDownloadClick}
                disabled={loadingCounts || total === 0}
                sx={{ color: (theme) => theme.palette.primary.main }}
              >
                {loadingCounts ? <CircularProgress size={24} /> : <DownloadIcon />}
              </IconButton>
              <IconButton
                aria-label="close"
                onClick={onClose}
                sx={{ color: (theme) => theme.palette.grey[500] }}
              >
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>

        {selectedIds.length > 0 ? (
          <Toolbar
            sx={{
              bgcolor: 'action.hover',
              borderTop: 1,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" sx={{ flex: 1 }}>
              {t('imageGroups:imageModal.selectedCount', { count: selectedIds.length })}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {!readOnly ? (
                <>
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={handleRemoveClick}
                    disabled={!canRemove}
                  >
                    {t('imageGroups:imageModal.buttonRemove')}
                  </Button>
                  <Button
                    variant="outlined"
                    color="primary"
                    startIcon={<MoveIcon />}
                    onClick={handleAssignClick}
                    disabled={!canAssign}
                  >
                    {t('imageGroups:imageModal.buttonAssign')}
                  </Button>
                </>
              ) : null}
            </Box>
          </Toolbar>
        ) : null}

        <DialogContent
          sx={{
            p: 2,
            overflow: 'auto',
            flex: 1,
          }}
        >
          {getSelectionMessage()}

          <ImageList
            images={images}
            loading={loading}
            contextId="group_modal"
            mode={activeMode}
            infiniteScroll={infiniteScroll}
            pagination={{
              currentPage,
              totalPages,
              onPageChange: onPageChange || (() => {}),
              pageSize: pageSize as number,
              onPageSizeChange: (size: number) => onPageSizeChange?.(size as PageSize),
            }}
            selectable={true}
            selection={{
              selectedIds,
              onSelectionChange: setSelectedIds,
            }}
            showCollectionType={true}
            currentGroupId={currentGroup?.id}
            total={total}
            isModal={true}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={removeDialogOpen} onClose={() => setRemoveDialogOpen(false)}>
        <DialogTitle>{t('imageGroups:imageModal.confirmRemoveTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('imageGroups:imageModal.confirmRemoveMessage', {
              count: selectedImages.filter((image) => {
                const groupInfo = image.groups?.find((g) => g.id === currentGroup?.id)
                return groupInfo?.collection_type === 'manual'
              }).length,
            })}
            <br />
            <strong>{t('imageGroups:imageModal.confirmRemoveNote')}</strong>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveDialogOpen(false)}>{t('common:buttons.cancel')}</Button>
          <Button onClick={handleRemoveConfirm} color="error" variant="contained">
            {t('imageGroups:imageModal.buttonRemove')}
          </Button>
        </DialogActions>
      </ConfirmDialog>

      <GroupAssignModal
        key={`assign-${assignDialogOpen ? 'open' : 'closed'}-${currentGroup?.id ?? 'none'}`}
        open={assignDialogOpen}
        onClose={() => setAssignDialogOpen(false)}
        selectedImageCount={selectedIds.length}
        onAssign={handleAssignConfirm}
        currentGroupId={currentGroup?.id}
      />

      <Menu anchorEl={downloadAnchorEl} open={Boolean(downloadAnchorEl)} onClose={handleDownloadMenuClose}>
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <Typography variant="subtitle2" color="text.secondary">
            {t('imageGroups:download.menuTitle')}
          </Typography>
        </MenuItem>

        <MenuItem disabled sx={{ opacity: '1 !important', mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {t('imageGroups:download.scopeAll')}
          </Typography>
        </MenuItem>
        <MenuItem onClick={() => handleDownloadTypeSelect('thumbnail', 'all')} disabled={!fileCounts || fileCounts.thumbnail === 0}>
          <ListItemIcon>
            <ImageIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('imageGroups:download.typeThumbnail')}
            {fileCounts ? ` (${fileCounts.thumbnail})` : ''}
          </ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleDownloadTypeSelect('original', 'all')} disabled={!fileCounts || fileCounts.original === 0}>
          <ListItemIcon>
            <PhotoLibraryIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('imageGroups:download.typeOriginal')}
            {fileCounts ? ` (${fileCounts.original})` : ''}
          </ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleDownloadTypeSelect('video', 'all')} disabled={!fileCounts || fileCounts.video === 0}>
          <ListItemIcon>
            <VideocamIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {t('imageGroups:download.typeVideo')}
            {fileCounts ? ` (${fileCounts.video})` : ''}
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleDownloadMenuClose()
            setLoraDialogScope('all')
            setLoraDialogOpen(true)
          }}
          disabled={!fileCounts || fileCounts.original === 0}
        >
          <ListItemIcon>
            <TextSnippetIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('imageGroups:download.typeLoraDataset')}</ListItemText>
        </MenuItem>

        {selectedIds.length > 0
          ? [
              <MenuItem key="selected-header" disabled sx={{ opacity: '1 !important', mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('imageGroups:download.scopeSelected', { count: selectedIds.length })}
                </Typography>
              </MenuItem>,
              <MenuItem key="selected-thumbnail" onClick={() => handleDownloadTypeSelect('thumbnail', 'selected')}>
                <ListItemIcon>
                  <ImageIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('imageGroups:download.typeThumbnail')}</ListItemText>
              </MenuItem>,
              <MenuItem key="selected-original" onClick={() => handleDownloadTypeSelect('original', 'selected')}>
                <ListItemIcon>
                  <PhotoLibraryIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('imageGroups:download.typeOriginal')}</ListItemText>
              </MenuItem>,
              <MenuItem key="selected-video" onClick={() => handleDownloadTypeSelect('video', 'selected')}>
                <ListItemIcon>
                  <VideocamIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('imageGroups:download.typeVideo')}</ListItemText>
              </MenuItem>,
              <MenuItem
                key="selected-lora-dataset"
                onClick={() => {
                  handleDownloadMenuClose()
                  setLoraDialogScope('selected')
                  setLoraDialogOpen(true)
                }}
              >
                <ListItemIcon>
                  <TextSnippetIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('imageGroups:download.typeLoraDataset')}</ListItemText>
              </MenuItem>,
            ]
          : null}
      </Menu>

      <LoraDatasetDialog open={loraDialogOpen} onClose={() => setLoraDialogOpen(false)} onConfirm={handleLoraDatasetDownload} />

      <ConfirmDialog open={downloadConfirmOpen} onClose={() => setDownloadConfirmOpen(false)}>
        <DialogTitle>{t('imageGroups:download.confirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('imageGroups:download.confirmMessage', {
              count: downloadScope === 'all' ? (fileCounts?.[pendingDownloadType || 'thumbnail'] || 0) : selectedIds.length,
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDownloadConfirmOpen(false)}>{t('common:buttons.cancel')}</Button>
          <Button onClick={handleDownloadConfirm} color="primary" variant="contained">
            {t('imageGroups:download.confirmButton')}
          </Button>
        </DialogActions>
      </ConfirmDialog>
    </>
  )
}

export default GroupImageGridModal
