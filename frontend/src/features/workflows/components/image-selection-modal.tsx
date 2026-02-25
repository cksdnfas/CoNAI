import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardMedia,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import {
  CloudUpload as UploadIcon,
  Folder as FolderIcon,
  History as HistoryIcon,
  Search as SearchIcon,
  Tag as TagIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { workflowApi } from '@/services/workflow-api'
import { ensureAbsoluteUrl } from '@/utils/backend'

interface ImageSelectionModalProps {
  open: boolean
  onClose: () => void
  onSelect: (imagePath: string) => void
  fieldLabel: string
}

interface TabPanelProps {
  children?: ReactNode
  index: number
  value: number
}

interface CanvasImage {
  path: string
  filename: string
}

function TabPanel({ children, value, index, ...other }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index ? <Box sx={{ p: 2 }}>{children}</Box> : null}
    </div>
  )
}

const isCanvasImage = (value: unknown): value is CanvasImage => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.path === 'string' && typeof record.filename === 'string'
}

export default function ImageSelectionModal({ open, onClose, onSelect, fieldLabel }: ImageSelectionModalProps) {
  const { t } = useTranslation(['workflows', 'common'])
  const [currentTab, setCurrentTab] = useState(0)
  const [hashInput, setHashInput] = useState('')
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)
  const [canvasImages, setCanvasImages] = useState<CanvasImage[]>([])
  const [canvasPath, setCanvasPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCanvasImages = useCallback(async () => {
    try {
      setLoading(true)
      const response = (await workflowApi.getCanvasImages()) as Record<string, unknown>

      const responseImages = Array.isArray(response.data) ? response.data.filter(isCanvasImage) : []
      const responseCanvasPath = typeof response.canvasPath === 'string' ? response.canvasPath : ''

      setCanvasImages(responseImages)
      setCanvasPath(responseCanvasPath)
    } catch (loadError) {
      setError('Failed to load canvas images')
      console.error(loadError)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && currentTab === 4) {
      void loadCanvasImages()
    }
  }, [open, currentTab, loadCanvasImages])

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setUploadPreview(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleSelectImage = (path: string) => {
    onSelect(path)
    onClose()
  }

  const handleClose = () => {
    setHashInput('')
    setUploadPreview(null)
    setError(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {fieldLabel} - {t('workflows:imageSelection.title')}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={currentTab} onChange={(_event, newValue) => setCurrentTab(newValue)}>
            <Tab icon={<SearchIcon />} label={t('workflows:imageSelection.tabs.dbSearch')} iconPosition="start" disabled />
            <Tab icon={<TagIcon />} label={t('workflows:imageSelection.tabs.hash')} iconPosition="start" />
            <Tab icon={<UploadIcon />} label={t('workflows:imageSelection.tabs.upload')} iconPosition="start" />
            <Tab icon={<HistoryIcon />} label={t('workflows:imageSelection.tabs.history')} iconPosition="start" disabled />
            <Tab icon={<FolderIcon />} label={t('workflows:imageSelection.tabs.dedicatedFolder')} iconPosition="start" />
          </Tabs>
        </Box>

        {error ? (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        <TabPanel value={currentTab} index={0}>
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body1" color="text.secondary">
              {t('workflows:imageSelection.inPreparation')}
            </Typography>
          </Box>
        </TabPanel>

        <TabPanel value={currentTab} index={1}>
          <TextField
            fullWidth
            label={t('workflows:imageSelection.hashInputLabel')}
            value={hashInput}
            onChange={(event) => setHashInput(event.target.value)}
            placeholder={t('workflows:imageSelection.hashInputPlaceholder')}
            sx={{ mb: 2 }}
          />
          {hashInput ? (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('workflows:imageSelection.hashComingSoon')}
              </Typography>
            </Box>
          ) : null}
        </TabPanel>

        <TabPanel value={currentTab} index={2}>
          <Box>
            <input accept="image/*" style={{ display: 'none' }} id="image-upload-input" type="file" onChange={handleFileUpload} />
            <label htmlFor="image-upload-input">
              <Button variant="outlined" component="span" fullWidth startIcon={<UploadIcon />} sx={{ mb: 2 }}>
                {t('workflows:imageSelection.selectButton')}
              </Button>
            </label>
            {uploadPreview ? (
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <img src={uploadPreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }} />
                <Box sx={{ mt: 2, display: 'flex', gap: 2, justifyContent: 'center' }}>
                  <Button variant="contained" onClick={() => handleSelectImage(uploadPreview)}>
                    {t('workflows:imageSelection.useAsIs')}
                  </Button>
                  <Button variant="outlined" disabled>
                    {t('workflows:imageSelection.editButton')}
                  </Button>
                </Box>
              </Box>
            ) : null}
          </Box>
        </TabPanel>

        <TabPanel value={currentTab} index={3}>
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body1" color="text.secondary">
              {t('workflows:imageSelection.inPreparation')}
            </Typography>
          </Box>
        </TabPanel>

        <TabPanel value={currentTab} index={4}>
          {loading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : canvasImages.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body1" color="text.secondary">
                {t('workflows:imageSelection.noImagesInFolder')}
              </Typography>
              {canvasPath ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {canvasPath} {t('workflows:imageSelection.addImagesPrompt')}
                </Typography>
              ) : null}
            </Box>
          ) : (
            <Grid container spacing={2}>
              {canvasImages.map((image) => (
                <Grid size={{ xs: 6, sm: 4, md: 3 }} key={`${image.path}-${image.filename}`}>
                  <Card>
                    <CardActionArea onClick={() => handleSelectImage(image.path)}>
                      <CardMedia
                        component="img"
                        height="140"
                        image={ensureAbsoluteUrl(image.path)}
                        alt={image.filename}
                        sx={{ objectFit: 'cover' }}
                      />
                      <Box sx={{ p: 1 }}>
                        <Typography variant="caption" noWrap>
                          {image.filename}
                        </Typography>
                      </Box>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </TabPanel>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('common:buttons.cancel')}</Button>
      </DialogActions>
    </Dialog>
  )
}
