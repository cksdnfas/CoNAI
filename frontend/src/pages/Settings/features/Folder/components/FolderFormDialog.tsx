import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControlLabel,
  Switch,
  Alert,
  Box,
  Chip,
  Tooltip,
  IconButton,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  Add as AddIcon,
  InfoOutlined as InfoOutlinedIcon,
  HelpOutline as HelpOutlineIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import { folderApi } from '../../../../../services/folderApi';
import type { WatchedFolder, WatchedFolderCreate, WatchedFolderUpdate } from '../../../../../types/folder';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  folder?: WatchedFolder | null;
}

const FolderFormDialog: React.FC<Props> = ({ open, onClose, folder, onSuccess }) => {
  const isEdit = !!folder;

  const [formData, setFormData] = useState<WatchedFolderCreate>({
    folder_path: '',
    folder_name: '',
    auto_scan: true,
    scan_interval: 60,
    recursive: true,
    exclude_extensions: [],
    exclude_patterns: [],
    watcher_enabled: true,
    watcher_polling_interval: null
  });

  const [newExtension, setNewExtension] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 폴더 데이터 로드 (편집 모드)
  useEffect(() => {
    if (folder) {
      setFormData({
        folder_path: folder.folder_path,
        folder_name: folder.folder_name || '',
        auto_scan: folder.auto_scan === 1,
        scan_interval: folder.scan_interval,
        recursive: folder.recursive === 1,
        exclude_extensions: folder.exclude_extensions ? JSON.parse(folder.exclude_extensions) : [],
        exclude_patterns: folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : [],
        watcher_enabled: folder.watcher_enabled === 1,
        watcher_polling_interval: folder.watcher_polling_interval
      });
    } else {
      // 초기화 - 제외 확장자는 빈 배열로 시작 (모든 지원 확장자 스캔)
      setFormData({
        folder_path: '',
        folder_name: '',
        auto_scan: true,
        scan_interval: 60,
        recursive: true,
        exclude_extensions: [],
        exclude_patterns: [],
        watcher_enabled: true,
        watcher_polling_interval: null
      });
    }
    setError(null);
  }, [folder, open]);

  // 제외 확장자 추가
  const handleAddExtension = () => {
    if (!newExtension.trim()) return;
    const ext = newExtension.trim().startsWith('.') ? newExtension.trim() : `.${newExtension.trim()}`;
    if (!formData.exclude_extensions?.includes(ext)) {
      setFormData({
        ...formData,
        exclude_extensions: [...(formData.exclude_extensions || []), ext]
      });
    }
    setNewExtension('');
  };

  // 제외 확장자 제거
  const handleRemoveExtension = (ext: string) => {
    setFormData({
      ...formData,
      exclude_extensions: formData.exclude_extensions?.filter(e => e !== ext)
    });
  };

  // 제외 패턴 추가
  const handleAddPattern = () => {
    if (!newPattern.trim()) return;
    if (!formData.exclude_patterns?.includes(newPattern.trim())) {
      setFormData({
        ...formData,
        exclude_patterns: [...(formData.exclude_patterns || []), newPattern.trim()]
      });
    }
    setNewPattern('');
  };

  // 제외 패턴 제거
  const handleRemovePattern = (pattern: string) => {
    setFormData({
      ...formData,
      exclude_patterns: formData.exclude_patterns?.filter(p => p !== pattern)
    });
  };

  // 저장
  const handleSave = async () => {
    if (!formData.folder_path.trim()) {
      setError('폴더 경로를 입력해주세요');
      return;
    }

    setSaving(true);
    try {
      setError(null);

      if (isEdit && folder) {
        // 편집 모드
        const updates: WatchedFolderUpdate = {
          folder_name: formData.folder_name,
          auto_scan: formData.auto_scan,
          scan_interval: formData.scan_interval,
          recursive: formData.recursive,
          exclude_extensions: formData.exclude_extensions,
          exclude_patterns: formData.exclude_patterns,
          watcher_enabled: formData.watcher_enabled,
          watcher_polling_interval: formData.watcher_polling_interval
        };
        await folderApi.updateFolder(folder.id, updates);
      } else {
        // 추가 모드
        await folderApi.addFolder(formData);
      }

      // 백엔드가 watcher 상태 업데이트할 시간 확보
      await new Promise(resolve => setTimeout(resolve, 500));

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || '폴더 저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{isEdit ? '폴더 편집' : '폴더 추가'}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 0.5 }}>
          {/* 폴더 경로 */}
          <TextField
            fullWidth
            label="폴더 경로 *"
            value={formData.folder_path}
            onChange={(e) => setFormData({ ...formData, folder_path: e.target.value })}
            disabled={isEdit}
            helperText={
              isEdit
                ? '폴더 경로는 편집할 수 없습니다'
                : '절대 경로를 입력해주세요 (예: D:\\Images 또는 \\\\192.168.1.100\\Share\\Images)'
            }
          />

          {/* 폴더 이름 */}
          <TextField
            fullWidth
            label="폴더 이름"
            value={formData.folder_name}
            onChange={(e) => setFormData({ ...formData, folder_name: e.target.value })}
            helperText="미입력 시 폴더명이 자동으로 사용됩니다"
          />

          {/* 실시간 감시 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.watcher_enabled}
                  onChange={(e) => setFormData({ ...formData, watcher_enabled: e.target.checked })}
                />
              }
              label="실시간 파일 감시 활성화"
            />
            <Tooltip
              title="실시간 감시는 폴더 내 파일 추가/수정/삭제를 즉시 감지하여 자동으로 처리합니다. 자동 스캔과 별개로 동작하며, 더 빠른 반응 속도를 제공합니다."
              arrow
              placement="right"
            >
              <IconButton size="small">
                <InfoOutlinedIcon fontSize="small" color="action" />
              </IconButton>
            </Tooltip>
          </Box>

          {/* 폴링 간격 (네트워크 드라이브용) */}
          {formData.watcher_enabled && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                  폴링 간격 (네트워크 드라이브용)
                </Typography>
                <Tooltip
                  title="네트워크 드라이브의 경우 폴링 방식으로 파일 변경을 감지합니다. 간격을 짧게 하면 더 빠르게 감지하지만 네트워크 부하가 증가합니다. 비워두면 자동으로 감지합니다 (기본: 1000ms)."
                  arrow
                >
                  <HelpOutlineIcon fontSize="small" color="action" sx={{ cursor: 'help' }} />
                </Tooltip>
              </Box>
              <TextField
                size="small"
                type="number"
                label="폴링 간격 (밀리초)"
                value={formData.watcher_polling_interval ?? ''}
                onChange={(e) => setFormData({
                  ...formData,
                  watcher_polling_interval: e.target.value === '' ? null : parseInt(e.target.value) || null
                })}
                placeholder="자동 감지 (네트워크 드라이브: 1000ms)"
                helperText="비워두면 자동으로 설정됩니다. 권장: 500-3000ms"
                sx={{ maxWidth: 300 }}
                inputProps={{ min: 100, step: 100 }}
              />
            </Box>
          )}

          {/* 자동 스캔 */}
          <FormControlLabel
            control={
              <Switch
                checked={formData.auto_scan}
                onChange={(e) => setFormData({ ...formData, auto_scan: e.target.checked })}
              />
            }
            label="자동 스캔 활성화"
          />

          {/* 스캔 간격 */}
          {formData.auto_scan && (
            <TextField
              fullWidth
              type="number"
              label="스캔 간격 (분)"
              value={formData.scan_interval}
              onChange={(e) => setFormData({ ...formData, scan_interval: parseInt(e.target.value) || 60 })}
              helperText="자동 스캔 주기 (분 단위)"
            />
          )}

          {/* 고급 옵션 */}
          <Accordion sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
              <Typography variant="body2" color="text.secondary">고급 옵션</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {/* 재귀 스캔 */}
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.recursive}
                      onChange={(e) => setFormData({ ...formData, recursive: e.target.checked })}
                    />
                  }
                  label="하위 폴더 포함 (재귀 스캔)"
                />

                {/* 제외 확장자 */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    제외할 확장자
                  </Typography>
                  <Tooltip
                    title="기본적으로 모든 이미지 형식 (.jpg, .png, .webp, .gif, .bmp, .tiff)을 스캔합니다. 스캔하지 않을 확장자가 있다면 아래에 추가하세요."
                    arrow
                  >
                    <HelpOutlineIcon fontSize="small" color="action" sx={{ cursor: 'help' }} />
                  </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    size="small"
                    value={newExtension}
                    onChange={(e) => setNewExtension(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddExtension()}
                    placeholder=".tmp"
                    sx={{ width: 200 }}
                  />
                  <Button onClick={handleAddExtension} startIcon={<AddIcon />} variant="outlined" size="small">
                    추가
                  </Button>
                </Box>
                {formData.exclude_extensions && formData.exclude_extensions.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {formData.exclude_extensions.map((ext) => (
                      <Chip
                        key={ext}
                        label={ext}
                        onDelete={() => handleRemoveExtension(ext)}
                        size="small"
                        color="error"
                        variant="outlined"
                      />
                    ))}
                  </Box>
                )}

                {/* 제외 패턴 */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    제외 패턴
                  </Typography>
                  <Tooltip
                    title="특정 폴더나 파일 패턴을 스캔에서 제외할 수 있습니다. 예: node_modules, .git, temp"
                    arrow
                  >
                    <HelpOutlineIcon fontSize="small" color="action" sx={{ cursor: 'help' }} />
                  </Tooltip>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    size="small"
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddPattern()}
                    placeholder="예: node_modules, .git"
                    sx={{ width: 300 }}
                  />
                  <Button onClick={handleAddPattern} startIcon={<AddIcon />} variant="outlined" size="small">
                    추가
                  </Button>
                </Box>
                {formData.exclude_patterns && formData.exclude_patterns.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {formData.exclude_patterns.map((pattern) => (
                      <Chip
                        key={pattern}
                        label={pattern}
                        onDelete={() => handleRemovePattern(pattern)}
                        size="small"
                      />
                    ))}
                  </Box>
                )}
              </Box>
            </AccordionDetails>
          </Accordion>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          취소
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? '저장 중...' : '저장'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FolderFormDialog;
