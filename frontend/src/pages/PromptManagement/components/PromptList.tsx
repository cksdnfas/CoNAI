import React, { useState, useEffect } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  IconButton,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Snackbar,
  CircularProgress,
  Typography,
  Menu,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Checkbox,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  CallSplit as GroupIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  PlaylistAdd as BulkAssignIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { promptCollectionApi, promptGroupApi } from '../../../services/api';
import type { PromptSearchResult, PromptGroupWithPrompts } from '@comfyui-image-manager/shared';
import PromptGroupManagementModal from './PromptGroupManagementModal';
import { BulkAssignModal } from './BulkAssignModal';

interface PromptListProps {
  type: 'positive' | 'negative';
}

const PromptList: React.FC<PromptListProps> = ({ type }) => {
  const { t } = useTranslation('promptManagement');
  const [prompts, setPrompts] = useState<PromptSearchResult[]>([]);
  const [groups, setGroups] = useState<PromptGroupWithPrompts[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<number | 'all' | 'unassigned'>('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalCount, setTotalCount] = useState(0);

  // 모달 상태
  const [isGroupManagementOpen, setIsGroupManagementOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [bulkAssignModalOpen, setBulkAssignModalOpen] = useState(false);

  // 체크박스 선택 상태
  const [selectedPrompts, setSelectedPrompts] = useState<Set<number>>(new Set());

  // 메뉴 상태
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  // 스낵바 상태
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info' | 'warning';
  }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // 프롬프트 목록 조회
  const fetchPrompts = async () => {
    try {
      setLoading(true);
      let groupId: number | null | undefined = undefined;
      if (selectedGroupFilter === 'unassigned') {
        groupId = null;
      } else if (typeof selectedGroupFilter === 'number') {
        groupId = selectedGroupFilter;
      }

      const response = await promptCollectionApi.searchPrompts(
        searchQuery,
        type,
        page + 1,
        rowsPerPage,
        'usage_count',
        'DESC',
        groupId
      );

      if (response.success && response.data) {
        setPrompts(Array.isArray(response.data) ? response.data : []);
        setTotalCount(response.pagination?.total || 0);
      } else {
        showSnackbar(t('promptList.messages.loadFailed'), 'error');
      }
    } catch (error) {
      console.error('Error fetching prompts:', error);
      showSnackbar(t('promptList.messages.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // 그룹 목록 조회
  const fetchGroups = async () => {
    try {
      const response = await promptGroupApi.getGroups(true, type);
      if (response.success && response.data) {
        setGroups(response.data);
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, [type]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchPrompts();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, selectedGroupFilter, page, rowsPerPage, type]);

  // 스낵바 표시
  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' | 'warning') => {
    setSnackbar({ open: true, message, severity });
  };

  // 스낵바 닫기
  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // 페이지 변경
  const handlePageChange = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  // 페이지 크기 변경
  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // 프롬프트 삭제
  const handleDeletePrompt = async (promptId: number) => {
    try {
      const response = await promptCollectionApi.deletePrompt(promptId, type);
      if (response.success) {
        showSnackbar(t('promptList.messages.deleteSuccess'), 'success');
        fetchPrompts();
      } else {
        showSnackbar(response.error || t('promptList.messages.deleteFailed'), 'error');
      }
    } catch (error) {
      console.error('Error deleting prompt:', error);
      showSnackbar(t('promptList.messages.deleteFailed'), 'error');
    }
  };

  // 그룹 할당 시작
  const handleAssignToGroup = (promptId: number) => {
    setSelectedPromptId(promptId);
    setAssignDialogOpen(true);
  };

  // 그룹 할당 실행
  const handleConfirmAssign = async () => {
    if (selectedPromptId === null) return;

    try {
      const response = await promptCollectionApi.assignPromptToGroup(
        selectedPromptId,
        selectedGroupId,
        type
      );
      if (response.success) {
        showSnackbar(t('promptList.messages.assignSuccess'), 'success');
        fetchPrompts();
      } else {
        showSnackbar(response.error || t('promptList.messages.assignFailed'), 'error');
      }
    } catch (error) {
      console.error('Error assigning prompt:', error);
      showSnackbar(t('promptList.messages.assignFailed'), 'error');
    }

    setAssignDialogOpen(false);
    setSelectedPromptId(null);
    setSelectedGroupId(null);
  };

  // 그룹 관리 메뉴 열기
  const handleGroupMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  // 그룹 관리 메뉴 닫기
  const handleGroupMenuClose = () => {
    setAnchorEl(null);
  };

  // 그룹명 가져오기
  const getGroupName = (groupId: number | null): string => {
    if (groupId === null) return t('promptList.statistics.unclassified');
    const group = groups.find(g => g.id === groupId);
    return group?.group_name || t('promptList.statistics.unknown');
  };

  // 삭제 가능 여부 확인
  const canDelete = (prompt: PromptSearchResult): boolean => {
    return prompt.usage_count === 0;
  };

  // 체크박스 선택 핸들러
  const handleSelectPrompt = (promptId: number) => {
    setSelectedPrompts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(promptId)) {
        newSet.delete(promptId);
      } else {
        newSet.add(promptId);
      }
      return newSet;
    });
  };

  // 전체 선택/해제
  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedPrompts(new Set(prompts.map((p) => p.id)));
    } else {
      setSelectedPrompts(new Set());
    }
  };

  // 선택된 프롬프트 할당
  const handleBulkAssignSelected = () => {
    if (selectedPrompts.size === 0) return;
    setBulkAssignModalOpen(true);
  };

  // 대량 할당 성공 시
  const handleBulkAssignSuccess = () => {
    setSelectedPrompts(new Set());
    fetchPrompts();
  };

  return (
    <Box>
      {/* 검색 및 필터 */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <TextField
          placeholder={t('promptList.search.placeholder', { type: type === 'positive' ? 'Positive' : 'Negative' })}
          variant="outlined"
          size="small"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
          }}
          sx={{ flexGrow: 1 }}
        />

        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>{t('promptList.filters.groupFilter.label')}</InputLabel>
          <Select
            value={selectedGroupFilter}
            label={t('promptList.filters.groupFilter.label')}
            onChange={(e) => setSelectedGroupFilter(e.target.value as any)}
          >
            <MenuItem value="all">{t('promptList.filters.groupFilter.all')}</MenuItem>
            <MenuItem value="unassigned">{t('promptList.filters.groupFilter.unassigned')}</MenuItem>
            {groups
              .filter(group => group.is_visible)
              .map((group) => (
                <MenuItem key={group.id} value={group.id}>
                  {group.group_name} ({group.prompt_count})
                </MenuItem>
              ))}
          </Select>
        </FormControl>

        <Button
          variant="outlined"
          startIcon={<SettingsIcon />}
          onClick={handleGroupMenuOpen}
        >
          {t('promptList.actions.groupManagement')}
        </Button>
      </Box>

      {/* 대량 작업 버튼 */}
      {selectedPrompts.size > 0 && (
        <Box sx={{ mb: 2, p: 2, bgcolor: 'primary.light', borderRadius: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
          <Typography variant="body2" sx={{ color: 'primary.contrastText', fontWeight: 500 }}>
            {t('promptList.bulkActions.selectedCount', { count: selectedPrompts.size })}
          </Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<BulkAssignIcon />}
            onClick={handleBulkAssignSelected}
            sx={{ bgcolor: 'white', color: 'primary.main', '&:hover': { bgcolor: 'grey.100' } }}
          >
            {t('promptList.bulkActions.assignSelected')}
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setSelectedPrompts(new Set())}
            sx={{ borderColor: 'white', color: 'white', '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' } }}
          >
            취소
          </Button>
        </Box>
      )}

      <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
        <Button
          variant="outlined"
          startIcon={<BulkAssignIcon />}
          onClick={() => setBulkAssignModalOpen(true)}
        >
          {t('promptList.bulkActions.bulkAssign')}
        </Button>
      </Box>

      {/* 테이블 */}
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  indeterminate={selectedPrompts.size > 0 && selectedPrompts.size < prompts.length}
                  checked={prompts.length > 0 && selectedPrompts.size === prompts.length}
                  onChange={handleSelectAll}
                />
              </TableCell>
              <TableCell>{t('promptList.table.headers.prompt')}</TableCell>
              <TableCell align="center">{t('promptList.table.headers.usageCount')}</TableCell>
              <TableCell align="center">{t('promptList.table.headers.assignedGroup')}</TableCell>
              <TableCell align="center">{t('promptList.table.headers.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <CircularProgress />
                </TableCell>
              </TableRow>
            ) : prompts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {t('promptList.table.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              prompts.map((prompt) => (
                <TableRow key={prompt.id} hover selected={selectedPrompts.has(prompt.id)}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selectedPrompts.has(prompt.id)}
                      onChange={() => handleSelectPrompt(prompt.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ maxWidth: 400 }}>
                      {prompt.prompt}
                    </Typography>
                    {prompt.synonyms && prompt.synonyms.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        {prompt.synonyms.slice(0, 3).map((synonym, index) => (
                          <Chip
                            key={index}
                            label={synonym}
                            size="small"
                            variant="outlined"
                            sx={{ mr: 0.5, mb: 0.5 }}
                          />
                        ))}
                        {prompt.synonyms.length > 3 && (
                          <Chip
                            label={t('promptList.table.synonyms.more', { count: prompt.synonyms.length - 3 })}
                            size="small"
                            variant="outlined"
                            color="primary"
                          />
                        )}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={prompt.usage_count}
                      size="small"
                      color={prompt.usage_count > 0 ? 'primary' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={getGroupName(prompt.group_id)}
                      size="small"
                      variant="outlined"
                      color={prompt.group_id === null ? 'default' : 'primary'}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                      <Tooltip title={t('promptList.actions.assignToGroup')}>
                        <IconButton
                          size="small"
                          onClick={() => handleAssignToGroup(prompt.id)}
                        >
                          <GroupIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={canDelete(prompt) ? t('promptList.actions.delete') : t('promptList.actions.cannotDelete')}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={!canDelete(prompt)}
                            onClick={() => handleDeletePrompt(prompt.id)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* 페이지네이션 */}
      <TablePagination
        rowsPerPageOptions={[10, 25, 50, 100]}
        component="div"
        count={totalCount}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handlePageChange}
        onRowsPerPageChange={handleRowsPerPageChange}
        labelRowsPerPage={t('promptList.pagination.rowsPerPage')}
        labelDisplayedRows={({ from, to, count }) => {
          const displayCount = count !== -1 ? count : `${to}+`;
          return `${from}-${to} / ${displayCount}`;
        }}
      />

      {/* 그룹 관리 메뉴 */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleGroupMenuClose}
      >
        <MenuItem onClick={() => {
          setIsGroupManagementOpen(true);
          handleGroupMenuClose();
        }}>
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('promptList.actions.groupManagement')}</ListItemText>
        </MenuItem>
      </Menu>

      {/* 그룹 할당 다이얼로그 */}
      <Dialog open={assignDialogOpen} onClose={() => setAssignDialogOpen(false)}>
        <DialogTitle>{t('assignDialog.title')}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1, minWidth: 300 }}>
            <InputLabel>{t('assignDialog.selectGroup.label')}</InputLabel>
            <Select
              value={selectedGroupId || ''}
              label={t('assignDialog.selectGroup.label')}
              onChange={(e) => setSelectedGroupId(e.target.value as number | null)}
            >
              <MenuItem value="">{t('assignDialog.selectGroup.unassigned')}</MenuItem>
              {groups
                .filter(group => group.is_visible)
                .map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    {group.group_name}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignDialogOpen(false)}>{t('assignDialog.actions.cancel')}</Button>
          <Button onClick={handleConfirmAssign} variant="contained">
            {t('assignDialog.actions.assign')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 그룹 관리 모달 */}
      <PromptGroupManagementModal
        open={isGroupManagementOpen}
        onClose={() => setIsGroupManagementOpen(false)}
        type={type}
        onGroupsChange={fetchGroups}
      />

      {/* 대량 할당 모달 */}
      <BulkAssignModal
        open={bulkAssignModalOpen}
        onClose={() => setBulkAssignModalOpen(false)}
        type={type}
        groups={groups}
        onSuccess={handleBulkAssignSuccess}
        selectedPromptTexts={prompts
          .filter((p) => selectedPrompts.has(p.id))
          .map((p) => p.prompt)}
      />

      {/* 스낵바 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleSnackbarClose}
      >
        <Alert
          onClose={handleSnackbarClose}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default PromptList;