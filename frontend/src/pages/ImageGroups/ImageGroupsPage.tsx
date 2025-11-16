import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Chip,
  IconButton,
  Fab,
  Menu,
  MenuItem,
  Alert,
  Snackbar,
  CircularProgress,
  Container,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as PlayIcon,
  Collections as GroupIcon,
  AutoAwesome as AutoIcon,
  Folder as FolderIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { groupApi } from '../../services/api';
import type { GroupWithStats, GroupWithHierarchy, BreadcrumbItem } from '@comfyui-image-manager/shared';
import type { ImageRecord, PageSize } from '../../types/image';
import GroupCreateEditModal from './components/GroupCreateEditModal';
import GroupImageGridModal from './components/GroupImageGridModal';
import { GroupBreadcrumb } from './components/GroupBreadcrumb';
import AutoFolderGroupsContent from './components/AutoFolderGroupsContent';
import { GroupCard } from './components/GroupCard';
import { ImageViewCard } from './components/ImageViewCard';
import { useRootGroups, useChildGroups, useDeleteGroup, useRunAutoCollection } from '../../hooks/useGroups';

const ImageGroupsPage: React.FC = () => {
  const { t } = useTranslation(['imageGroups', 'common']);
  const [tabValue, setTabValue] = useState(0);
  const [selectedGroup, setSelectedGroup] = useState<GroupWithHierarchy | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuGroupId, setMenuGroupId] = useState<number | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info' | 'warning';
  }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // 계층 네비게이션 상태
  const [isGroupListView, setIsGroupListView] = useState(true); // true = 그룹 목록 뷰
  const [selectedRootGroupId, setSelectedRootGroupId] = useState<number | null>(null); // 선택된 루트 그룹
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);
  const [currentGroupInfo, setCurrentGroupInfo] = useState<GroupWithStats | null>(null); // 현재 부모 그룹 정보
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);

  // React Query hooks for data fetching
  const { data: rootGroupsData, isLoading: rootGroupsLoading } = useRootGroups(currentParentId);
  const { data: childGroupsData, isLoading: childGroupsLoading } = useChildGroups(currentParentId);
  const deleteGroupMutation = useDeleteGroup();
  const runAutoCollectionMutation = useRunAutoCollection();

  // Use appropriate data based on current navigation state
  const groups = (currentParentId === null ? rootGroupsData : childGroupsData) || [];
  const loading = currentParentId === null ? rootGroupsLoading : childGroupsLoading;

  // 그룹 이미지 모달 관련 상태
  const [groupImagesModalOpen, setGroupImagesModalOpen] = useState(false);
  const [selectedGroupForImages, setSelectedGroupForImages] = useState<GroupWithStats | null>(null);
  const [groupImages, setGroupImages] = useState<ImageRecord[]>([]);
  const [groupImagesLoading, setGroupImagesLoading] = useState(false);
  const [groupImagesPage, setGroupImagesPage] = useState(1);
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1);
  const [groupImagesTotal, setGroupImagesTotal] = useState(0);
  const [groupImagesPageSize, setGroupImagesPageSize] = useState<PageSize>(25);

  // 브레드크럼 로드
  const loadBreadcrumb = async (groupId: number) => {
    try {
      const response = await groupApi.getBreadcrumbPath(groupId);
      if (response.success && response.data) {
        setBreadcrumb(response.data);
      }
    } catch (error) {
      console.error('Error loading breadcrumb:', error);
    }
  };

  // 그룹 네비게이션 (하위 그룹이 1개만 있으면 자동 진입)
  const navigateToGroup = async (groupId: number | null, autoNavigate: boolean = true) => {
    setCurrentParentId(groupId);
    if (groupId === null) {
      setBreadcrumb([]);
      setCurrentGroupInfo(null);
    } else {
      await loadBreadcrumb(groupId);
      // 현재 그룹 정보 로드
      try {
        const groupResponse = await groupApi.getGroup(groupId);
        console.log('[navigateToGroup] Group API response:', groupResponse);
        if (groupResponse.success && groupResponse.data) {
          console.log('[navigateToGroup] Setting currentGroupInfo:', groupResponse.data);
          setCurrentGroupInfo(groupResponse.data as GroupWithStats);
        } else {
          console.error('[navigateToGroup] Failed to load group info:', groupResponse);
        }
      } catch (error) {
        console.error('Error loading current group info:', error);
      }
    }

    // React Query will automatically fetch the groups based on currentParentId
    // Auto-navigation logic will be handled by useEffect watching groups data
  };

  // 하위 그룹 열기
  const openSubgroups = (group: GroupWithHierarchy) => {
    navigateToGroup(group.id);
  };

  // 브레드크럼 클릭 핸들러 (자동 진입 비활성화)
  const handleBreadcrumbNavigate = (groupId: number | null) => {
    if (groupId === null) {
      // 그룹 목록으로 돌아가기
      setIsGroupListView(true);
      setSelectedRootGroupId(null);
      setCurrentParentId(null);
      setCurrentGroupInfo(null);
      setBreadcrumb([]);
    } else {
      navigateToGroup(groupId, false);
    }
  };

  // Auto-navigation effect
  useEffect(() => {
    if (groups.length === 1 && currentParentId !== null) {
      const singleGroup = groups[0];
      if (singleGroup.image_count === 0 && singleGroup.child_count === 1) {
        const currentGroupName = currentGroupInfo?.name || '그룹';
        showSnackbar(`하위 그룹으로 자동 이동: ${currentGroupName} → ${singleGroup.name}`, 'info');
        navigateToGroup(singleGroup.id, true);
      }
    }
  }, [groups, currentParentId]);

  // 그룹 이미지 조회
  const fetchGroupImages = async (groupId: number, page: number = 1, pageSize?: PageSize) => {
    try {
      setGroupImagesLoading(true);
      const actualPageSize = pageSize || groupImagesPageSize;
      const response = await groupApi.getGroupImages(groupId, page, actualPageSize);

      if (response.success && response.data) {
        setGroupImages(response.data.images || []);
        setGroupImagesPage(response.data.pagination?.page || 1);
        setGroupImagesTotalPages(response.data.pagination?.totalPages || 1);
        setGroupImagesTotal(response.data.pagination?.total || 0);
      } else {
        showSnackbar(t('imageGroups:messages.imageLoadFailed'), 'error');
        setGroupImages([]);
      }
    } catch (error) {
      console.error('Error fetching group images:', error);
      showSnackbar(t('imageGroups:messages.imageLoadFailed'), 'error');
      setGroupImages([]);
    } finally {
      setGroupImagesLoading(false);
    }
  };

  // 스낵바 표시
  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' | 'warning') => {
    setSnackbar({ open: true, message, severity });
  };

  // 스낵바 닫기
  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // 메뉴 열기
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, groupId: number) => {
    setAnchorEl(event.currentTarget);
    setMenuGroupId(groupId);
  };

  // 메뉴 닫기
  const handleMenuClose = () => {
    setAnchorEl(null);
    setMenuGroupId(null);
  };

  // 그룹 설정 (설정 버튼 클릭)
  const handleGroupSettings = (groupId: number) => {
    const group = groups.find(g => g.id === groupId);
    if (group) {
      setSelectedGroup(group);
      setIsEditModalOpen(true);
    }
  };

  // 그룹 편집
  const handleEditGroup = () => {
    const group = groups.find(g => g.id === menuGroupId);
    if (group) {
      setSelectedGroup(group);
      setIsEditModalOpen(true);
    }
    handleMenuClose();
  };

  // 그룹 삭제
  const handleDeleteGroup = async () => {
    if (!menuGroupId) return;

    try {
      await deleteGroupMutation.mutateAsync({ id: menuGroupId, cascade: false });
      showSnackbar(t('imageGroups:messages.deleteSuccess'), 'success');
    } catch (error) {
      console.error('Error deleting group:', error);
      showSnackbar(t('imageGroups:messages.deleteFailed'), 'error');
    }
    handleMenuClose();
  };

  // 자동수집 실행
  const handleRunAutoCollection = async () => {
    if (!menuGroupId) return;

    try {
      const result = await runAutoCollectionMutation.mutateAsync(menuGroupId);
      showSnackbar(
        t('imageGroups:messages.autoCollectSuccess', {
          added: result.images_added,
          removed: result.images_removed
        }),
        'success'
      );
    } catch (error) {
      console.error('Error running auto collection:', error);
      showSnackbar(t('imageGroups:messages.autoCollectFailed'), 'error');
    }
    handleMenuClose();
  };

  // 그룹 생성 성공 핸들러
  const handleGroupCreated = () => {
    setIsCreateModalOpen(false);
    showSnackbar('그룹이 생성되었습니다. 브라우저를 새로고침해주세요.', 'info');
    // Cache will be automatically invalidated by the mutation hook
  };

  // 그룹 수정 성공 핸들러
  const handleGroupUpdated = () => {
    setIsEditModalOpen(false);
    setSelectedGroup(null);
    showSnackbar('그룹이 수정되었습니다. 브라우저를 새로고침해주세요.', 'info');
    // Cache will be automatically invalidated by the mutation hook
  };

  // 그룹 카드 클릭 핸들러
  const handleGroupClick = (group: GroupWithStats) => {
    // 그룹 목록 뷰에서는 루트 그룹을 선택하여 해당 그룹의 루트로 진입
    if (isGroupListView) {
      setIsGroupListView(false);
      setSelectedRootGroupId(group.id);
      setCurrentParentId(group.id);
      navigateToGroup(group.id);
      return;
    }

    // 그룹 내부에서는 기존 로직 유지
    // 하위 그룹이 있으면 하위 그룹 목록으로 이동
    if ((group as any).child_count && (group as any).child_count > 0) {
      navigateToGroup(group.id);
    } else if (group.image_count > 0) {
      // 하위 그룹 없고 이미지가 있으면 모달 열기
      setSelectedGroupForImages(group);
      setGroupImagesModalOpen(true);
      setGroupImagesPage(1); // 페이지 초기화
      fetchGroupImages(group.id, 1, groupImagesPageSize);
    } else {
      // 둘 다 없으면 빈 그룹 메시지 표시
      showSnackbar(t('imageGroups:messages.emptyGroup'), 'info');
    }
  };

  // 그룹 이미지 모달 닫기
  const handleGroupImagesModalClose = () => {
    setGroupImagesModalOpen(false);
    setSelectedGroupForImages(null);
    setGroupImages([]);
    setGroupImagesPage(1);
  };

  // 그룹 이미지 페이지 변경
  const handleGroupImagesPageChange = (page: number) => {
    if (selectedGroupForImages) {
      setGroupImagesPage(page);
      fetchGroupImages(selectedGroupForImages.id, page, groupImagesPageSize);
    }
  };

  // 그룹 이미지 페이지 사이즈 변경
  const handleGroupImagesPageSizeChange = (size: PageSize) => {
    setGroupImagesPageSize(size);
    if (selectedGroupForImages) {
      setGroupImagesPage(1);
      fetchGroupImages(selectedGroupForImages.id, 1, size);
    }
  };

  // 이미지 제거 핸들러
  const handleImagesRemoved = async (manualImageIds: string[]) => {
    if (!selectedGroupForImages) return;

    try {
      if (manualImageIds.length === 0) {
        showSnackbar(t('imageGroups:messages.removeWarning'), 'warning');
        return;
      }

      const result = await groupApi.removeImagesFromGroup(selectedGroupForImages.id, manualImageIds);

      if (result.success) {
        showSnackbar(t('imageGroups:messages.removeSuccess', { count: result.removed }), 'success');
      } else {
        showSnackbar(
          t('imageGroups:messages.removePartialSuccess', {
            removed: result.removed,
            failed: result.errors.length
          }),
          'warning'
        );
      }

      // 제거 후 그룹 이미지 목록 다시 조회하여 페이지 확인
      const updatedResult = await groupApi.getGroupImages(
        selectedGroupForImages.id,
        groupImagesPage,
        groupImagesPageSize
      );

      // 현재 페이지가 비어있고, 이전 페이지가 존재하면 이전 페이지로 이동
      if (updatedResult.success && updatedResult.data) {
        const hasImages = updatedResult.data.images && updatedResult.data.images.length > 0;
        const hasPreviousPage = groupImagesPage > 1;

        if (!hasImages && hasPreviousPage) {
          // 빈 페이지이고 이전 페이지가 있으면 이전 페이지로 이동
          setGroupImagesPage(groupImagesPage - 1);
          fetchGroupImages(selectedGroupForImages.id, groupImagesPage - 1, groupImagesPageSize);
        } else {
          // 현재 페이지에 이미지가 있거나 첫 페이지면 현재 페이지 유지
          fetchGroupImages(selectedGroupForImages.id, groupImagesPage, groupImagesPageSize);
        }
      } else {
        // 조회 실패 시 현재 페이지 새로고침
        fetchGroupImages(selectedGroupForImages.id, groupImagesPage, groupImagesPageSize);
      }

      // Cache will be automatically invalidated by the mutation hook
    } catch (error) {
      console.error('Error removing images:', error);
      showSnackbar(t('imageGroups:messages.removeError'), 'error');
    }
  };

  // 이미지 할당 핸들러
  const handleImagesAssigned = async (targetGroupId: number, selectedImageIds: string[]) => {
    try {
      const response = await groupApi.addImagesToGroup(targetGroupId, selectedImageIds);

      if (response.success && response.data) {
        const { added_count, converted_count, skipped_count } = response.data;
        showSnackbar(
          t('imageGroups:messages.assignSuccess', {
            added: added_count,
            converted: converted_count,
            skipped: skipped_count
          }),
          'success'
        );
      } else {
        showSnackbar(response.error || t('imageGroups:messages.assignFailed'), 'error');
      }

      // Cache will be automatically invalidated by the mutation hook
    } catch (error) {
      console.error('Error assigning images:', error);
      showSnackbar(t('imageGroups:messages.assignError'), 'error');
    }
  };

  // 대표 이미지 URL 생성
  const getRepresentativeImageUrl = (group: GroupWithStats): string => {
    // 그룹에 이미지가 있으면 랜덤 썸네일을 사용, 없으면 플레이스홀더
    if (group.image_count > 0) {
      return groupApi.getThumbnailUrl(group.id);
    }

    // 이미지가 없을 때 플레이스홀더 SVG
    const svgContent = `
      <svg width="300" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f5f5f5"/>
        <text x="50%" y="50%" text-anchor="middle" dy=".3em" font-family="Arial, sans-serif" font-size="16" fill="#666">
          ${group.name.replace(/[<>&"']/g, (char) => {
      const entities: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return entities[char] || char;
    })}
        </text>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {t('imageGroups:page.title')}
        </Typography>

        {/* 탭 네비게이션 */}
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)} sx={{ mt: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={t('imageGroups:page.customGroupsTab')} />
          <Tab label={t('imageGroups:page.autoFolderGroupsTab')} />
        </Tabs>
      </Box>

      {/* 커스텀 그룹 탭 */}
      <Box sx={{ display: tabValue === 0 ? 'block' : 'none' }}>
      {/* 브레드크럼 네비게이션 (그룹 내부에서만 표시) */}
      {!isGroupListView && (
        <GroupBreadcrumb
          breadcrumb={breadcrumb}
          onNavigate={handleBreadcrumbNavigate}
          showGroupListRoot={true}
        />
      )}

      {/* 현재 그룹에 이미지가 있거나 하위 그룹이 있으면 그리드 표시 */}
      {(() => {
        console.log('[Render] isGroupListView:', isGroupListView);
        console.log('[Render] currentParentId:', currentParentId);
        console.log('[Render] currentGroupInfo:', currentGroupInfo);
        console.log('[Render] groups.length:', groups.length);
        return (!isGroupListView && currentParentId !== null && currentGroupInfo && currentGroupInfo.image_count > 0) || groups.length > 0;
      })() ? (
        <Grid container spacing={3}>
          {/* 그룹 내부 뷰: 현재 그룹의 이미지 보기 카드를 가장 앞에 표시 */}
          {!isGroupListView && currentParentId !== null && currentGroupInfo && currentGroupInfo.image_count > 0 && (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2, xl: 1.5 }} key={`image-view-${currentParentId}`}>
              <ImageViewCard
                group={currentGroupInfo}
                onClick={() => {
                  setSelectedGroupForImages(currentGroupInfo);
                  setGroupImagesModalOpen(true);
                  setGroupImagesPage(1);
                  fetchGroupImages(currentGroupInfo.id, 1, groupImagesPageSize);
                }}
              />
            </Grid>
          )}

          {/* 하위 그룹 카드들 */}
          {groups.map((group) => (
            <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2, xl: 1.5 }} key={group.id}>
              <GroupCard
                group={group}
                onClick={() => handleGroupClick(group)}
                onSettingsClick={handleGroupSettings}
              />
            </Grid>
          ))}
        </Grid>
      ) : (
        <Box textAlign="center" py={8}>
          <GroupIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {isGroupListView ? '생성된 그룹이 없습니다' : '하위 그룹이 없습니다'}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {isGroupListView
              ? '+ 버튼을 눌러 새 그룹을 생성하세요'
              : '현재 그룹에는 하위 그룹이 없습니다'}
          </Typography>
        </Box>
      )}

      {/* 그룹 생성 FAB */}
      <Fab
        color="primary"
        aria-label="add group"
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
        }}
        onClick={() => setIsCreateModalOpen(true)}
      >
        <AddIcon />
      </Fab>

      {/* 컨텍스트 메뉴 */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleEditGroup}>
          <EditIcon sx={{ mr: 1 }} fontSize="small" />
          {t('common:edit')}
        </MenuItem>
        {groups.find(g => g.id === menuGroupId)?.auto_collect_enabled ? (
          <MenuItem onClick={handleRunAutoCollection}>
            <PlayIcon sx={{ mr: 1 }} fontSize="small" />
            {t('imageGroups:menu.runAutoCollection')}
          </MenuItem>
        ) : null}
        <MenuItem onClick={handleDeleteGroup} sx={{ color: 'error.main' }}>
          <DeleteIcon sx={{ mr: 1 }} fontSize="small" />
          {t('common:delete')}
        </MenuItem>
      </Menu>

      {/* 그룹 생성 모달 */}
      <GroupCreateEditModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleGroupCreated}
      />

      {/* 그룹 편집 모달 */}
      {selectedGroup ? (
        <GroupCreateEditModal
          open={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setSelectedGroup(null);
          }}
          onSuccess={handleGroupUpdated}
          group={selectedGroup}
        />
      ) : null}

      {/* 그룹 이미지 모달 */}
      <GroupImageGridModal
        open={groupImagesModalOpen}
        onClose={handleGroupImagesModalClose}
        images={groupImages}
        loading={groupImagesLoading}
        currentGroup={selectedGroupForImages}
        allGroups={groups}
        pageSize={groupImagesPageSize}
        onPageSizeChange={handleGroupImagesPageSizeChange}
        currentPage={groupImagesPage}
        totalPages={groupImagesTotalPages}
        total={groupImagesTotal}
        onPageChange={handleGroupImagesPageChange}
        onImagesRemoved={handleImagesRemoved}
        onImagesAssigned={handleImagesAssigned}
      />
      </Box>

      {/* 자동폴더 그룹 탭 */}
      <Box sx={{ display: tabValue === 1 ? 'block' : 'none' }}>
        <AutoFolderGroupsContent onShowSnackbar={showSnackbar} />
      </Box>

      {/* 스낵바 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2000}
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
    </Container>
  );
};

export default ImageGroupsPage;