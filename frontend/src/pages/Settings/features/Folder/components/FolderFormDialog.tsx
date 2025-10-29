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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Box,
  Chip,
  IconButton
} from '@mui/material';
import { Add as AddIcon, Close as CloseIcon } from '@mui/icons-material';
import { folderApi } from '../../../../../services/folderApi';
import type { WatchedFolder, WatchedFolderCreate, WatchedFolderUpdate, FolderType } from '../../../../../types/folder';

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
    folder_type: 'scan',
    auto_scan: true,
    scan_interval: 60,
    recursive: true,
    file_extensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    exclude_patterns: []
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
        folder_type: folder.folder_type,
        auto_scan: folder.auto_scan === 1,
        scan_interval: folder.scan_interval,
        recursive: folder.recursive === 1,
        file_extensions: folder.file_extensions ? JSON.parse(folder.file_extensions) : [],
        exclude_patterns: folder.exclude_patterns ? JSON.parse(folder.exclude_patterns) : []
      });
    } else {
      // 초기화
      setFormData({
        folder_path: '',
        folder_name: '',
        folder_type: 'scan',
        auto_scan: true,
        scan_interval: 60,
        recursive: true,
        file_extensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
        exclude_patterns: []
      });
    }
    setError(null);
  }, [folder, open]);

  // 확장자 추가
  const handleAddExtension = () => {
    if (!newExtension.trim()) return;
    const ext = newExtension.trim().startsWith('.') ? newExtension.trim() : `.${newExtension.trim()}`;
    if (!formData.file_extensions?.includes(ext)) {
      setFormData({
        ...formData,
        file_extensions: [...(formData.file_extensions || []), ext]
      });
    }
    setNewExtension('');
  };

  // 확장자 제거
  const handleRemoveExtension = (ext: string) => {
    setFormData({
      ...formData,
      file_extensions: formData.file_extensions?.filter(e => e !== ext)
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
          file_extensions: formData.file_extensions,
          exclude_patterns: formData.exclude_patterns
        };
        await folderApi.updateFolder(folder.id, updates);
      } else {
        // 추가 모드
        await folderApi.addFolder(formData);
      }

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

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* 폴더 경로 */}
          <TextField
            fullWidth
            label="폴더 경로 *"
            value={formData.folder_path}
            onChange={(e) => setFormData({ ...formData, folder_path: e.target.value })}
            disabled={isEdit}
            helperText={isEdit ? '폴더 경로는 편집할 수 없습니다' : '절대 경로를 입력해주세요'}
          />

          {/* 폴더 이름 */}
          <TextField
            fullWidth
            label="폴더 이름"
            value={formData.folder_name}
            onChange={(e) => setFormData({ ...formData, folder_name: e.target.value })}
            helperText="미입력 시 폴더명이 자동으로 사용됩니다"
          />

          {/* 폴더 타입 */}
          <FormControl fullWidth disabled={isEdit}>
            <InputLabel>폴더 타입</InputLabel>
            <Select
              value={formData.folder_type}
              label="폴더 타입"
              onChange={(e) => setFormData({ ...formData, folder_type: e.target.value as FolderType })}
            >
              <MenuItem value="upload">직접 업로드</MenuItem>
              <MenuItem value="scan">스캔 폴더</MenuItem>
              <MenuItem value="archive">아카이브</MenuItem>
            </Select>
          </FormControl>

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

          {/* 파일 확장자 */}
          <Box>
            <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
              <TextField
                size="small"
                label="파일 확장자 추가"
                value={newExtension}
                onChange={(e) => setNewExtension(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddExtension()}
                placeholder=".jpg"
              />
              <Button onClick={handleAddExtension} startIcon={<AddIcon />}>
                추가
              </Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {formData.file_extensions?.map((ext) => (
                <Chip
                  key={ext}
                  label={ext}
                  onDelete={() => handleRemoveExtension(ext)}
                  size="small"
                />
              ))}
            </Box>
          </Box>

          {/* 제외 패턴 */}
          <Box>
            <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
              <TextField
                size="small"
                label="제외 패턴 추가"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddPattern()}
                placeholder="예: node_modules, .git"
              />
              <Button onClick={handleAddPattern} startIcon={<AddIcon />}>
                추가
              </Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {formData.exclude_patterns?.map((pattern) => (
                <Chip
                  key={pattern}
                  label={pattern}
                  onDelete={() => handleRemovePattern(pattern)}
                  size="small"
                />
              ))}
            </Box>
          </Box>
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
