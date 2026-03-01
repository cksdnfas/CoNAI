import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Image as ImageIcon, Images as PhotoLibraryIcon, Loader2, MoveRight as MoveIcon, Text as TextSnippetIcon, Video as VideocamIcon, Download as DownloadIcon, X as CloseIcon, Trash2 as DeleteIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GroupWithStats } from '@comfyui-image-manager/shared'
import type { ImageRecord, PageSize } from '@/types/image'
import ImageList from '@/features/images/components/image-list'
import { createInfiniteImageListAdapter, createPaginationImageListAdapter, getImageStableIdentity } from '@/features/images/components/image-list-contract'
import GroupAssignModal from './group-assign-modal'
import { groupApi } from '@/services/group-api'
import { autoFolderGroupsApi } from '@/services/auto-folder-groups-api'
import { useImageListSettings } from '@/hooks/use-image-list-settings'
import LoraDatasetDialog from './lora-dataset-dialog'
import { Button as UiButton } from '@/components/ui/button'
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert'

type Sx = Record<string, unknown>

const sxToStyle = (sx?: Sx): React.CSSProperties | undefined => {
  if (!sx) return undefined
  const style: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(sx)) {
    if (!key.startsWith('&') && typeof value !== 'object') {
      style[key] = value
    }
  }
  return style as React.CSSProperties
}

const Box: React.FC<React.PropsWithChildren<{ sx?: Sx; className?: string; component?: string }>> = ({ sx, className, children }) => (
  <div className={className} style={sxToStyle(sx)}>{children}</div>
)

const Typography: React.FC<any> = ({ children, sx }) => (
  <span style={sxToStyle(sx)}>{children}</span>
)

const CircularProgress: React.FC<{ size?: number }> = ({ size = 16 }) => <Loader2 className="animate-spin" style={{ width: size, height: size }} />

const Button: React.FC<React.PropsWithChildren<{ variant?: 'contained' | 'outlined' | 'text'; color?: string; startIcon?: React.ReactNode; onClick?: () => void; disabled?: boolean; sx?: Sx }>> = ({ variant = 'text', color, startIcon, onClick, disabled, sx, children }) => {
  const mappedVariant = variant === 'contained' ? 'default' : variant === 'outlined' ? 'outline' : 'ghost'
  return (
    <UiButton type="button" variant={mappedVariant} onClick={onClick} disabled={disabled} style={{ color: color === 'error' ? 'hsl(var(--destructive))' : undefined, ...sxToStyle(sx) }}>
      {startIcon}
      {children}
    </UiButton>
  )
}

const IconButton: React.FC<React.PropsWithChildren<{ onClick?: (event: React.MouseEvent<HTMLElement>) => void; disabled?: boolean; sx?: Sx; 'aria-label'?: string }>> = ({ children, onClick, disabled, sx, ...props }) => (
  <button type="button" onClick={onClick} disabled={disabled} style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 8, background: 'transparent', ...sxToStyle(sx) }} {...props}>
    {children}
  </button>
)

const Dialog: React.FC<any> = ({ open, onClose, children, PaperProps }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-[95vw] max-w-[1200px] overflow-hidden rounded-lg border bg-background" style={sxToStyle(PaperProps?.sx)}>
        {onClose ? (
          <div className="flex justify-end border-b px-2 py-1">
            <UiButton type="button" variant="ghost" size="icon-sm" onClick={onClose}>
              <CloseIcon className="h-4 w-4" />
            </UiButton>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  )
}

const ConfirmDialog: React.FC<any> = Dialog

const DialogTitle: React.FC<any> = ({ children }) => <div className="border-b px-4 py-3 font-semibold">{children}</div>
const DialogContent: React.FC<any> = ({ children, sx }) => <div className="p-4" style={sxToStyle(sx)}>{children}</div>
const DialogActions: React.FC<any> = ({ children }) => <div className="flex justify-end gap-2 border-t px-4 py-3">{children}</div>
const DialogContentText: React.FC<any> = ({ children }) => <p className="text-sm text-muted-foreground">{children}</p>

const Toolbar: React.FC<any> = ({ children, sx }) => <div style={sxToStyle(sx)} className="flex items-center gap-2 px-4 py-2">{children}</div>

const Alert: React.FC<any> = ({ severity, sx, children }) => (
  <UiAlert variant={severity === 'error' ? 'destructive' : 'default'} style={sxToStyle(sx)}>
    {severity === 'error' ? <AlertCircle className="h-4 w-4" /> : null}
    <AlertDescription>{children}</AlertDescription>
  </UiAlert>
)

const Menu: React.FC<any> = ({ open, children, onClose }) => {
  if (!open) return null
  return (
    <div className="fixed right-8 top-24 z-[60] min-w-[260px] rounded-md border bg-popover p-1 shadow-lg">
      {onClose ? (
        <div className="mb-1 flex justify-end">
          <UiButton type="button" variant="ghost" size="icon-xs" onClick={onClose}>
            <CloseIcon className="h-3.5 w-3.5" />
          </UiButton>
        </div>
      ) : null}
      {children}
    </div>
  )
}

const MenuItem: React.FC<any> = ({ onClick, disabled, children, sx }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="hover:bg-muted disabled:text-muted-foreground flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm" style={sxToStyle(sx)}>
    {children}
  </button>
)

const ListItemIcon: React.FC<any> = ({ children }) => <span className="inline-flex h-4 w-4 items-center justify-center">{children}</span>
const ListItemText: React.FC<any> = ({ children }) => <span>{children}</span>

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

  const [selectedStableKeys, setSelectedStableKeys] = useState<string[]>([])
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

  const selectedImages = useMemo(
    () => images.filter((image, index) => selectedStableKeys.includes(getImageStableIdentity(image, index).stableKey)),
    [images, selectedStableKeys],
  )
  const hasManualSelected = selectedImages.some((image) => {
    const groupInfo = image.groups?.find((g) => g.id === currentGroup?.id)
    return groupInfo?.collection_type === 'manual'
  })
  const hasAutoSelected = selectedImages.some((image) => {
    const groupInfo = image.groups?.find((g) => g.id === currentGroup?.id)
    return groupInfo?.collection_type === 'auto'
  })

  const canRemove = hasManualSelected && !hasAutoSelected && selectedImages.length > 0
  const canAssign = selectedImages.length > 0
  const imageListAdapter = activeMode === 'infinite'
    ? createInfiniteImageListAdapter({
        contextId: 'group_modal',
        infiniteScroll: infiniteScroll ?? { hasMore: false, loadMore: () => undefined },
        total,
        showCollectionType: true,
        currentGroupId: currentGroup?.id,
        isModal: true,
      })
    : createPaginationImageListAdapter({
        contextId: 'group_modal',
        pagination: {
          currentPage,
          totalPages,
          onPageChange: onPageChange || (() => undefined),
          pageSize: pageSize as number,
          onPageSizeChange: (size: number) => onPageSizeChange?.(size as PageSize),
        },
        total,
        showCollectionType: true,
        currentGroupId: currentGroup?.id,
        isModal: true,
      })

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
    setSelectedStableKeys([])
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
    setSelectedStableKeys([])
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

    const count = scope === 'all' ? (fileCounts?.[type] || 0) : selectedImages.length
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
      if (scope === 'selected' && selectedImages.length > 0) {
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
      if (loraDialogScope === 'selected' && selectedImages.length > 0) {
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
    if (selectedImages.length === 0) return null

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
                sx={{ color: 'primary.main' }}
              >
                {loadingCounts ? <CircularProgress size={24} /> : <DownloadIcon />}
              </IconButton>
              <IconButton
                aria-label="close"
                onClick={onClose}
                sx={{ color: 'grey.500' }}
              >
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>

        {selectedImages.length > 0 ? (
          <Toolbar
            sx={{
              bgcolor: 'action.hover',
              borderTop: 1,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" sx={{ flex: 1 }}>
              {t('imageGroups:imageModal.selectedCount', { count: selectedImages.length })}
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
            adapter={imageListAdapter}
            selectable={true}
            selection={{
              selectedIds: selectedImages
                .map((image) => image.id)
                .filter((id): id is number => typeof id === 'number'),
              onSelectionChange: () => undefined,
              selectedStableKeys,
              onStableSelectionChange: setSelectedStableKeys,
            }}
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
        selectedImageCount={selectedImages.length}
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

        {selectedImages.length > 0
          ? [
              <MenuItem key="selected-header" disabled sx={{ opacity: '1 !important', mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('imageGroups:download.scopeSelected', { count: selectedImages.length })}
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
              count: downloadScope === 'all' ? (fileCounts?.[pendingDownloadType || 'thumbnail'] || 0) : selectedImages.length,
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
