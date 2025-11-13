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
  Button,
  Menu,
  MenuItem,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  MoreVert as MoreVertIcon,
  Refresh as RefreshIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { autoFolderGroupsApi } from '../../../services/api';
import type { AutoFolderGroupWithStats } from '@comfyui-image-manager/shared';
import type { ImageRecord } from '../../../types/image';
import { GroupBreadcrumb } from './GroupBreadcrumb';
import GroupImageGridModal from './GroupImageGridModal';

interface AutoFolderGroupsContentProps {
  onShowSnackbar: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void;
}

const AutoFolderGroupsContent: React.FC<AutoFolderGroupsContentProps> = ({ onShowSnackbar }) => {
  const { t } = useTranslation(['imageGroups', 'common']);
  const [groups, setGroups] = useState<AutoFolderGroupWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuGroupId, setMenuGroupId] = useState<number | null>(null);

  // 계층 네비게이션 상태
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<Array<{ id: number; name: string }>>([]);

  // 이미지 모달 상태
  const [groupImagesModalOpen, setGroupImagesModalOpen] = useState(false);
  const [selectedGroupForImages, setSelectedGroupForImages] = useState<AutoFolderGroupWithStats | null>(null);
  const [groupImages, setGroupImages] = useState<ImageRecord[]>([]);
  const [groupImagesLoading, setGroupImagesLoading] = useState(false);
  const [groupImagesPage, setGroupImagesPage] = useState(1);
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1);
  const [groupImagesTotal, setGroupImagesTotal] = useState(0);
  const [groupImagesPageSize, setGroupImagesPageSize] = useState<25 | 50 | 100>(25);

  // 그룹 목록 조회
  const fetchGroups = async (parentId: number | null = null) => {
    try {
      setLoading(true);
      const response = parentId === null
        ? await autoFolderGroupsApi.getRootGroups()
        : await autoFolderGroupsApi.getChildGroups(parentId);

      if (response.success && response.data) {
        setGroups(response.data);
      } else {
        onShowSnackbar(t('imageGroups:messages.loadFailed'), 'error');
      }
    } catch (error) {
      console.error('Error fetching auto folder groups:', error);
      onShowSnackbar(t('imageGroups:messages.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // 브레드크럼 로드
  const loadBreadcrumb = async (groupId: number) => {
    try {
      const response = await autoFolderGroupsApi.getBreadcrumbPath(groupId);
      if (response.success && response.data) {
        setBreadcrumb(response.data);
      }
    } catch (error) {
      console.error('Error loading breadcrumb:', error);
    }
  };

  // 초기 로드
  useEffect(() => {
    fetchGroups(currentParentId);
    if (currentParentId !== null) {
      loadBreadcrumb(currentParentId);
    }
  }, [currentParentId]);

  // 재구축
  const handleRebuild = async () => {
    try {
      setRebuilding(true);
      const response = await autoFolderGroupsApi.rebuild();

      if (response.success && response.data) {
        onShowSnackbar(
          `재구축 완료: ${response.data.groups_created}개 그룹, ${response.data.images_assigned}개 이미지 (${response.data.duration_ms}ms)`,
          'success'
        );
        fetchGroups(currentParentId);
      } else {
        onShowSnackbar(response.error || '재구축 실패', 'error');
      }
    } catch (error) {
      console.error('Error rebuilding:', error);
      onShowSnackbar('재구축 중 오류 발생', 'error');
    } finally {
      setRebuilding(false);
    }
  };

  // 그룹 네비게이션 (하위 그룹이 1개만 있으면 자동 진입)
  const navigateToGroup = async (group: AutoFolderGroupWithStats) => {
    setCurrentParentId(group.id);
    await loadBreadcrumb(group.id);

    // 그룹 목록 조회
    const response = await autoFolderGroupsApi.getChildGroups(group.id);

    if (response.success && response.data) {
      const fetchedGroups = response.data;
      setGroups(fetchedGroups);

      // 자동 진입 조건: 하위 그룹이 정확히 1개이고, 이미지가 없으면 계속 진입
      if (fetchedGroups.length === 1) {
        const singleGroup = fetchedGroups[0];

        if (singleGroup.image_count === 0 && singleGroup.child_count === 1) {
          // 재귀적으로 하위 그룹으로 진입
          await navigateToGroup(singleGroup);
          return;
        }
      }
    } else {
      onShowSnackbar(t('imageGroups:messages.loadFailed'), 'error');
    }
  };

  const handleBreadcrumbClick = async (groupId: number | null) => {
    setCurrentParentId(groupId);
    if (groupId === null) {
      setBreadcrumb([]);
      await fetchGroups(null);
    } else {
      await loadBreadcrumb(groupId);

      // 그룹 목록 조회
      const response = await autoFolderGroupsApi.getChildGroups(groupId);

      if (response.success && response.data) {
        const fetchedGroups = response.data;
        setGroups(fetchedGroups);

        // 자동 진입 조건: 하위 그룹이 정확히 1개이고, 이미지가 없으면 계속 진입
        if (fetchedGroups.length === 1) {
          const singleGroup = fetchedGroups[0];

          if (singleGroup.image_count === 0 && singleGroup.child_count === 1) {
            // 재귀적으로 하위 그룹으로 진입
            await navigateToGroup(singleGroup);
            return;
          }
        }
      } else {
        onShowSnackbar(t('imageGroups:messages.loadFailed'), 'error');
      }
    }
  };

  // 컨텍스트 메뉴
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, groupId: number) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setMenuGroupId(groupId);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setMenuGroupId(null);
  };

  const handleViewImages = () => {
    const group = groups.find(g => g.id === menuGroupId);
    if (group) {
      setSelectedGroupForImages(group);
      setGroupImagesModalOpen(true);
      loadGroupImages(group.id, 1);
    }
    handleMenuClose();
  };

  // 그룹 이미지 로드
  const loadGroupImages = async (groupId: number, page: number) => {
    try {
      setGroupImagesLoading(true);
      const response = await autoFolderGroupsApi.getGroupImages(groupId, page, groupImagesPageSize);

      if (response.success && response.data) {
        setGroupImages(response.data.items);
        setGroupImagesPage(response.data.pagination.page);
        setGroupImagesTotalPages(response.data.pagination.totalPages);
        setGroupImagesTotal(response.data.pagination.total);
      }
    } catch (error) {
      console.error('Error loading group images:', error);
      onShowSnackbar(t('imageGroups:messages.imageLoadFailed'), 'error');
    } finally {
      setGroupImagesLoading(false);
    }
  };

  // 이미지 모달 핸들러
  const handleGroupImagesModalClose = () => {
    setGroupImagesModalOpen(false);
    setSelectedGroupForImages(null);
    setGroupImages([]);
    setGroupImagesPage(1);
  };

  const handleGroupImagesPageChange = (newPage: number) => {
    if (selectedGroupForImages) {
      loadGroupImages(selectedGroupForImages.id, newPage);
    }
  };

  const handleGroupImagesPageSizeChange = (newSize: 25 | 50 | 100) => {
    setGroupImagesPageSize(newSize);
    if (selectedGroupForImages) {
      loadGroupImages(selectedGroupForImages.id, 1);
    }
  };

  // 대표 이미지 URL
  const getRepresentativeImageUrl = (group: AutoFolderGroupWithStats): string => {
    if (group.image_count > 0) {
      return autoFolderGroupsApi.getThumbnailUrl(group.id);
    }

    // 이미지 없는 폴더 플레이스홀더
    const svgContent = `
      <svg width="300" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#424242"/>
        <text x="50%" y="50%" text-anchor="middle" dy=".3em" font-family="Arial, sans-serif" font-size="16" fill="#bbb">
          📁 ${group.display_name.replace(/[<>&"']/g, (char) => {
            const entities: Record<string, string> = {
              '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
            };
            return entities[char] || char;
          })}
        </text>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
  };

  if (loading && groups.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      {/* 상단 액션 바 */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Alert severity="info" sx={{ flex: 1, mr: 2 }}>
          읽기 전용 그룹입니다. 원본 파일 위치를 변경하면 자동으로 반영됩니다.
        </Alert>
        <Button
          variant="contained"
          startIcon={rebuilding ? <CircularProgress size={20} /> : <RefreshIcon />}
          onClick={handleRebuild}
          disabled={rebuilding}
        >
          {rebuilding ? '재구축 중...' : '새로고침'}
        </Button>
      </Box>

      {/* 브레드크럼 */}
      {(currentParentId !== null || breadcrumb.length > 0) && (
        <GroupBreadcrumb
          breadcrumb={breadcrumb}
          onNavigate={handleBreadcrumbClick}
        />
      )}

      {/* 그룹 그리드 */}
      {groups.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <FolderOpenIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('imageGroups:page.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            새로고침 버튼을 눌러 폴더 구조를 생성하세요.
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {groups.map((group) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={group.id}>
              <Card
                sx={{
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                  },
                  opacity: group.has_images ? 1 : 0.7,
                }}
                onClick={() => {
                  if (group.child_count && group.child_count > 0) {
                    navigateToGroup(group);
                  } else if (group.image_count > 0) {
                    setSelectedGroupForImages(group);
                    setGroupImagesModalOpen(true);
                    loadGroupImages(group.id, 1);
                  }
                }}
              >
                <CardMedia
                  component="img"
                  height="160"
                  image={getRepresentativeImageUrl(group)}
                  alt={group.display_name}
                  sx={{ objectFit: 'cover' }}
                />
                <CardContent sx={{ position: 'relative' }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 1 }}>
                    <FolderIcon sx={{ mr: 1, color: 'primary.main' }} />
                    <Typography variant="h6" component="div" sx={{ flex: 1, wordBreak: 'break-word' }}>
                      {group.display_name}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={(e) => handleMenuOpen(e, group.id)}
                      sx={{ ml: 1 }}
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                      label={t('imageGroups:groupCard.imageCount', { count: group.image_count })}
                      size="small"
                      color={group.image_count > 0 ? 'primary' : 'default'}
                    />
                    {group.child_count > 0 && (
                      <Chip
                        label={t('imageGroups:hierarchy.childGroups', { count: group.child_count })}
                        size="small"
                        color="secondary"
                      />
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* 컨텍스트 메뉴 */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleViewImages}>
          이미지 보기
        </MenuItem>
      </Menu>

      {/* 이미지 모달 (읽기 전용) */}
      <GroupImageGridModal
        open={groupImagesModalOpen}
        onClose={handleGroupImagesModalClose}
        images={groupImages}
        loading={groupImagesLoading}
        currentGroup={selectedGroupForImages}
        allGroups={[]}
        pageSize={groupImagesPageSize}
        onPageSizeChange={handleGroupImagesPageSizeChange}
        currentPage={groupImagesPage}
        totalPages={groupImagesTotalPages}
        total={groupImagesTotal}
        onPageChange={handleGroupImagesPageChange}
        onImagesRemoved={() => {}}
        onImagesAssigned={() => {}}
        readOnly={true}
      />
    </>
  );
};

export default AutoFolderGroupsContent;
