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
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as PlayIcon,
  Collections as GroupIcon,
  AutoAwesome as AutoIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { groupApi } from '../../services/api';
import type { GroupWithStats, GroupWithHierarchy, BreadcrumbItem } from '@comfyui-image-manager/shared';
import type { ImageRecord, PageSize } from '../../types/image';
import GroupCreateEditModal from './components/GroupCreateEditModal';
import GroupImageGridModal from './components/GroupImageGridModal';
import { GroupBreadcrumb } from './components/GroupBreadcrumb';

const ImageGroupsPage: React.FC = () => {
  const { t } = useTranslation(['imageGroups', 'common']);
  const [groups, setGroups] = useState<GroupWithHierarchy[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);

  // 그룹 이미지 모달 관련 상태
  const [groupImagesModalOpen, setGroupImagesModalOpen] = useState(false);
  const [selectedGroupForImages, setSelectedGroupForImages] = useState<GroupWithStats | null>(null);
  const [groupImages, setGroupImages] = useState<ImageRecord[]>([]);
  const [groupImagesLoading, setGroupImagesLoading] = useState(false);
  const [groupImagesPage, setGroupImagesPage] = useState(1);
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1);
  const [groupImagesTotal, setGroupImagesTotal] = useState(0);
  const [groupImagesPageSize, setGroupImagesPageSize] = useState<PageSize>(25);

  // 그룹 목록 조회 (계층 기반)
  const fetchGroups = async (parentId: number | null = null) => {
    try {
      setLoading(true);
      const response = parentId === null
        ? await groupApi.getRootGroups()
        : await groupApi.getChildGroups(parentId);

      if (response.success && response.data) {
        setGroups(response.data);
      } else {
        showSnackbar(t('imageGroups:messages.loadFailed'), 'error');
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      showSnackbar(t('imageGroups:messages.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

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

  // 그룹 네비게이션
  const navigateToGroup = async (groupId: number | null) => {
    setCurrentParentId(groupId);
    if (groupId === null) {
      setBreadcrumb([]);
    } else {
      await loadBreadcrumb(groupId);
    }
    await fetchGroups(groupId);
  };

  // 하위 그룹 열기
  const openSubgroups = (group: GroupWithHierarchy) => {
    navigateToGroup(group.id);
  };

  useEffect(() => {
    fetchGroups();
  }, []);

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
      const response = await groupApi.deleteGroup(menuGroupId);
      if (response.success) {
        showSnackbar(t('imageGroups:messages.deleteSuccess'), 'success');
        fetchGroups();
      } else {
        showSnackbar(response.error || t('imageGroups:messages.deleteFailed'), 'error');
      }
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
      const response = await groupApi.runAutoCollection(menuGroupId);
      if (response.success && response.data) {
        const result = response.data;
        showSnackbar(
          t('imageGroups:messages.autoCollectSuccess', {
            added: result.images_added,
            removed: result.images_removed
          }),
          'success'
        );
        fetchGroups();
      } else {
        showSnackbar(response.error || t('imageGroups:messages.autoCollectFailed'), 'error');
      }
    } catch (error) {
      console.error('Error running auto collection:', error);
      showSnackbar(t('imageGroups:messages.autoCollectFailed'), 'error');
    }
    handleMenuClose();
  };

  // 그룹 생성 성공 핸들러
  const handleGroupCreated = () => {
    setIsCreateModalOpen(false);
    fetchGroups();
    showSnackbar(t('imageGroups:messages.createSuccess'), 'success');
  };

  // 그룹 수정 성공 핸들러
  const handleGroupUpdated = () => {
    setIsEditModalOpen(false);
    setSelectedGroup(null);
    fetchGroups();
    showSnackbar(t('imageGroups:messages.updateSuccess'), 'success');
  };

  // 그룹 카드 클릭 핸들러 (이미지 보기)
  const handleGroupClick = (group: GroupWithStats) => {
    setSelectedGroupForImages(group);
    setGroupImagesModalOpen(true);
    setGroupImagesPage(1); // 페이지 초기화
    fetchGroupImages(group.id, 1, groupImagesPageSize);
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

      // 그룹 목록 새로고침
      fetchGroups();
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

      // 그룹 목록 새로고침
      fetchGroups();
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
        <Typography variant="body1" color="text.secondary">
          {t('imageGroups:page.description')}
        </Typography>
      </Box>

      {/* 브레드크럼 네비게이션 */}
      {(currentParentId !== null || breadcrumb.length > 0) && (
        <GroupBreadcrumb
          breadcrumb={breadcrumb}
          onNavigate={navigateToGroup}
        />
      )}

      {groups.length === 0 ? (
        <Box textAlign="center" py={8}>
          <GroupIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('imageGroups:page.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {t('imageGroups:page.emptyDescription')}
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={3}>
          {groups.map((group) => (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={group.id}>
              <Card
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: (theme) => theme.shadows[8],
                  },
                }}
                onClick={() => handleGroupClick(group)}
              >
                <CardMedia
                  component="img"
                  height="200"
                  image={getRepresentativeImageUrl(group)}
                  alt={group.name}
                  sx={{
                    objectFit: 'cover',
                    backgroundColor: 'grey.100',
                  }}
                  onError={(e) => {
                    // 이미지 로드 실패 시 플레이스홀더로 대체
                    const target = e.target as HTMLImageElement;
                    if (target.src !== getRepresentativeImageUrl({...group, image_count: 0})) {
                      target.src = getRepresentativeImageUrl({...group, image_count: 0});
                    }
                  }}
                />
                <CardContent sx={{ flexGrow: 1, position: 'relative' }}>
                  <Box sx={{ position: 'absolute', top: 8, right: 8 }}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation(); // 카드 클릭 이벤트 방지
                        handleMenuOpen(e, group.id);
                      }}
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </Box>

                  <Typography
                    variant="h6"
                    component="h2"
                    gutterBottom
                    noWrap
                    sx={{ pr: 5 }}
                  >
                    {group.name}
                  </Typography>

                  {group.description ? (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        mb: 2,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {group.description}
                    </Typography>
                  ) : null}

                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                    <Chip
                      icon={<GroupIcon />}
                      label={t('imageGroups:groupCard.imageCount', { count: group.image_count })}
                      size="small"
                      variant="outlined"
                    />
                    {group.auto_collect_enabled ? (
                      <Chip
                        icon={<AutoIcon />}
                        label={t('imageGroups:groupCard.autoCollect')}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    ) : null}
                    {group.has_children ? (
                      <Chip
                        label={t('imageGroups:hierarchy.childGroups', { count: group.child_count })}
                        size="small"
                        color="secondary"
                        variant="outlined"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSubgroups(group);
                        }}
                        sx={{ cursor: 'pointer' }}
                      />
                    ) : null}
                  </Box>

                  {group.auto_collect_enabled && group.image_count > 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      {t('imageGroups:groupCard.stats', {
                        auto: group.auto_collected_count || 0,
                        manual: group.manual_added_count || 0
                      })}
                    </Typography>
                  ) : null}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
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
    </Container>
  );
};

export default ImageGroupsPage;