import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tabs,
  Tab,
  Box,
  TextField,
  Typography,
  Grid,
  Card,
  CardMedia,
  CardActionArea,
  CircularProgress,
  Alert
} from '@mui/material';
import {
  Search as SearchIcon,
  Tag as TagIcon,
  CloudUpload as UploadIcon,
  History as HistoryIcon,
  Folder as FolderIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { workflowApi } from '../../../services/api/workflowApi';

interface ImageSelectionModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (imagePath: string) => void;
  fieldLabel: string;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      {...other}
    >
      {value === index && <Box sx={{ p: 2 }}>{children}</Box>}
    </div>
  );
}

export default function ImageSelectionModal({
  open,
  onClose,
  onSelect,
  fieldLabel
}: ImageSelectionModalProps) {
  const { t } = useTranslation(['workflows', 'common']);
  const [currentTab, setCurrentTab] = useState(0);
  const [hashInput, setHashInput] = useState('');
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [canvasImages, setCanvasImages] = useState<any[]>([]);
  const [canvasPath, setCanvasPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && currentTab === 4) {
      loadCanvasImages();
    }
  }, [open, currentTab]);

  const loadCanvasImages = async () => {
    try {
      setLoading(true);
      const response = await workflowApi.getCanvasImages();
      setCanvasImages(response.data || []);
      setCanvasPath(response.canvasPath || '');
    } catch (err: any) {
      setError('Failed to load canvas images');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSelectImage = (path: string) => {
    onSelect(path);
    onClose();
  };

  const handleClose = () => {
    setHashInput('');
    setUploadPreview(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>{fieldLabel} - {t('workflows:imageSelection.title')}</DialogTitle>
      <DialogContent>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={currentTab} onChange={(_, newValue) => setCurrentTab(newValue)}>
            <Tab icon={<SearchIcon />} label={t('workflows:imageSelection.tabs.dbSearch')} iconPosition="start" disabled />
            <Tab icon={<TagIcon />} label={t('workflows:imageSelection.tabs.hash')} iconPosition="start" />
            <Tab icon={<UploadIcon />} label={t('workflows:imageSelection.tabs.upload')} iconPosition="start" />
            <Tab icon={<HistoryIcon />} label={t('workflows:imageSelection.tabs.history')} iconPosition="start" disabled />
            <Tab icon={<FolderIcon />} label={t('workflows:imageSelection.tabs.dedicatedFolder')} iconPosition="start" />
          </Tabs>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Tab 0: DB 검색 (미구현) */}
        <TabPanel value={currentTab} index={0}>
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body1" color="text.secondary">
              {t('workflows:imageSelection.inPreparation')}
            </Typography>
          </Box>
        </TabPanel>

        {/* Tab 1: 해시로 가져오기 */}
        <TabPanel value={currentTab} index={1}>
          <TextField
            fullWidth
            label={t('workflows:imageSelection.hashInputLabel')}
            value={hashInput}
            onChange={(e) => setHashInput(e.target.value)}
            placeholder={t('workflows:imageSelection.hashInputPlaceholder')}
            sx={{ mb: 2 }}
          />
          {hashInput && (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('workflows:imageSelection.hashComingSoon')}
              </Typography>
            </Box>
          )}
        </TabPanel>

        {/* Tab 2: 신규 이미지 업로드 */}
        <TabPanel value={currentTab} index={2}>
          <Box>
            <input
              accept="image/*"
              style={{ display: 'none' }}
              id="image-upload-input"
              type="file"
              onChange={handleFileUpload}
            />
            <label htmlFor="image-upload-input">
              <Button
                variant="outlined"
                component="span"
                fullWidth
                startIcon={<UploadIcon />}
                sx={{ mb: 2 }}
              >
                {t('workflows:imageSelection.selectButton')}
              </Button>
            </label>
            {uploadPreview && (
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <img
                  src={uploadPreview}
                  alt="Preview"
                  style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }}
                />
                <Box sx={{ mt: 2, display: 'flex', gap: 2, justifyContent: 'center' }}>
                  <Button
                    variant="contained"
                    onClick={() => {
                      if (uploadPreview) {
                        handleSelectImage(uploadPreview);
                      }
                    }}
                  >
                    {t('workflows:imageSelection.useAsIs')}
                  </Button>
                  <Button variant="outlined" disabled>
                    {t('workflows:imageSelection.editButton')}
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        </TabPanel>

        {/* Tab 3: 히스토리 목록 (미구현) */}
        <TabPanel value={currentTab} index={3}>
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body1" color="text.secondary">
              {t('workflows:imageSelection.inPreparation')}
            </Typography>
          </Box>
        </TabPanel>

        {/* Tab 4: 전용 폴더 */}
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
              {canvasPath && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {canvasPath} {t('workflows:imageSelection.addImagesPrompt')}
                </Typography>
              )}
            </Box>
          ) : (
            <Grid container spacing={2}>
              {canvasImages.map((image, index) => (
                <Grid size={{ xs: 6, sm: 4, md: 3 }} key={index}>
                  <Card>
                    <CardActionArea onClick={() => handleSelectImage(image.path)}>
                      <CardMedia
                        component="img"
                        height="140"
                        image={`http://localhost:1666${image.path}`}
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
  );
}
