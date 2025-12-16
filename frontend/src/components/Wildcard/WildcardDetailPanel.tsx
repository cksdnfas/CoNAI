import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Divider,
  Stack,
  Card,
  CardContent,
  Chip,
  useMediaQuery,
  useTheme,
  Tabs,
  Tab
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Folder as FolderIcon,
  Description as FileIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { WildcardWithHierarchy } from '../../services/api/wildcardApi';

interface WildcardDetailPanelProps {
  selectedNode: WildcardWithHierarchy | null;
  onCopy: (text: string) => void;
  onChildClick?: (node: WildcardWithHierarchy) => void;
  actionButtons?: React.ReactNode;
  extraInfo?: React.ReactNode; // 추가 정보 영역 (예: Item Counts Chips)
  emptyMessage?: string;
  sortChildren?: (a: WildcardWithHierarchy, b: WildcardWithHierarchy) => number;
  showAllItems?: boolean; // 모든 아이템 보기 (Manual 탭용)
  renderExtraContent?: (node: WildcardWithHierarchy) => React.ReactNode; // 추가 컨텐츠 렌더링
}

/**
 * 선택된 와일드카드의 상세 정보를 표시하는 우측 패널 컴포넌트
 */
export function WildcardDetailPanel({
  selectedNode,
  onCopy,
  onChildClick,
  actionButtons,
  extraInfo,
  emptyMessage,
  sortChildren,
  showAllItems = false,
  renderExtraContent
}: WildcardDetailPanelProps) {
  const { t } = useTranslation(['wildcards', 'common']);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [contentTab, setContentTab] = useState<'children' | 'comfyui' | 'nai'>('children');

  // 자식 노드 정렬
  const sortedChildren = selectedNode?.children && sortChildren
    ? [...selectedNode.children].sort(sortChildren)
    : selectedNode?.children || [];

  // ComfyUI / NAI 아이템 필터링
  const comfyuiItems = selectedNode?.items?.filter((i) => i.tool === 'comfyui') || [];
  const naiItems = selectedNode?.items?.filter((i) => i.tool === 'nai') || [];

  // 탭 표시 여부 결정
  const hasChildren = sortedChildren.length > 0;
  const hasComfyuiItems = comfyuiItems.length > 0;
  const hasNaiItems = naiItems.length > 0;

  // 표시할 탭이 여러 개인지 확인 (부모 와일드카드인 경우)
  const showTabs = (hasChildren && (hasComfyuiItems || hasNaiItems)) || (hasComfyuiItems && hasNaiItems);

  // 초기 탭 설정
  React.useEffect(() => {
    if (selectedNode) {
      if (hasChildren) {
        setContentTab('children');
      } else if (hasComfyuiItems) {
        setContentTab('comfyui');
      } else if (hasNaiItems) {
        setContentTab('nai');
      }
    }
  }, [selectedNode?.id, hasChildren, hasComfyuiItems, hasNaiItems]);

  // 현재 렌더링 시점에 유효한 탭 값 계산
  let activeTab = contentTab;
  if (activeTab === 'children' && !hasChildren) {
    if (hasComfyuiItems) activeTab = 'comfyui';
    else if (hasNaiItems) activeTab = 'nai';
  } else if (activeTab === 'comfyui' && !hasComfyuiItems) {
    if (hasChildren) activeTab = 'children';
    else if (hasNaiItems) activeTab = 'nai';
  } else if (activeTab === 'nai' && !hasNaiItems) {
    if (hasChildren) activeTab = 'children';
    else if (hasComfyuiItems) activeTab = 'comfyui';
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        flex: 1,
        minHeight: isMobile ? 300 : 400,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        p: 2
      }}
    >
      {selectedNode ? (
        <>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
            <Box
              sx={{ cursor: 'pointer', flex: 1, '&:hover': { opacity: 0.7 } }}
              onClick={() => onCopy(selectedNode.type === 'chain' ? selectedNode.name : `++${selectedNode.name}++`)}
              title={t('common:copy') || 'Copy'}
            >
              <Typography variant="h5" sx={{ fontFamily: 'monospace' }}>
                {selectedNode.type === 'chain' ? selectedNode.name : `++${selectedNode.name}++`}
              </Typography>
              {selectedNode.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {selectedNode.description}
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <IconButton
                onClick={() => onCopy(selectedNode.type === 'chain' ? selectedNode.name : `++${selectedNode.name}++`)}
                title={t('common:copy') || 'Copy'}
              >
                <CopyIcon />
              </IconButton>
              {actionButtons}
            </Box>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {/* Extra Info (예: Item Counts) */}
          {extraInfo && (
            <Box sx={{ mb: 2 }}>
              {extraInfo}
            </Box>
          )}

          {/* Content: Tabs or Direct Display */}
          <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {renderExtraContent ? (
              renderExtraContent(selectedNode)
            ) : showTabs ? (
              <>
                {/* Multi-Content Tabs */}
                <Tabs
                  value={activeTab}
                  onChange={(_, newValue) => setContentTab(newValue)}
                  sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    minHeight: 48,
                    '& .MuiTabs-indicator': {
                      height: 3,
                      borderRadius: '3px 3px 0 0'
                    }
                  }}
                >
                  {hasChildren && (
                    <Tab
                      value="children"
                      label={`${t('wildcards:detail.children') || '하위 항목'} (${sortedChildren.length})`}
                      sx={{
                        minHeight: 48,
                        fontWeight: activeTab === 'children' ? 600 : 400,
                        '&.Mui-selected': {
                          color: 'warning.main'
                        }
                      }}
                    />
                  )}
                  {hasComfyuiItems && (
                    <Tab
                      value="comfyui"
                      label={`ComfyUI (${comfyuiItems.length})`}
                      sx={{
                        minHeight: 48,
                        fontWeight: activeTab === 'comfyui' ? 600 : 400,
                        '&.Mui-selected': {
                          color: 'primary.main'
                        }
                      }}
                    />
                  )}
                  {hasNaiItems && (
                    <Tab
                      value="nai"
                      label={`NAI (${naiItems.length})`}
                      sx={{
                        minHeight: 48,
                        fontWeight: activeTab === 'nai' ? 600 : 400,
                        '&.Mui-selected': {
                          color: 'secondary.main'
                        }
                      }}
                    />
                  )}
                </Tabs>

                {/* Tab Content */}
                <Box sx={{ flex: 1, overflow: 'auto', mt: 2 }}>
                  {activeTab === 'children' && hasChildren && (
                    <Stack spacing={1}>
                      {sortedChildren.map((child) => (
                        <Card
                          key={child.id}
                          variant="outlined"
                          sx={{
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            '&:hover': {
                              bgcolor: 'action.hover',
                              borderColor: 'primary.main'
                            }
                          }}
                          onClick={() => onChildClick?.(child)}
                        >
                          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                              {child.children && child.children.length > 0 ? (
                                <FolderIcon fontSize="small" color="warning" />
                              ) : (
                                <FileIcon fontSize="small" color="info" />
                              )}
                              <Typography variant="body1" sx={{ flex: 1, fontFamily: 'monospace' }}>
                                {child.type === 'chain' ? child.name : `++${child.name}++`}
                              </Typography>
                              {child.children && child.children.length > 0 && (
                                <Chip
                                  label={`${child.children.length} sub`}
                                  size="small"
                                  variant="outlined"
                                />
                              )}
                              {child.items && child.items.length > 0 && (
                                <Chip
                                  label={`${child.items.filter(i => i.tool === 'comfyui').length} items`}
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                />
                              )}
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCopy(child.type === 'chain' ? child.name : `++${child.name}++`);
                                }}
                                title={t('common:copy') || 'Copy'}
                              >
                                <CopyIcon fontSize="small" />
                              </IconButton>
                            </Stack>
                          </CardContent>
                        </Card>
                      ))}
                    </Stack>
                  )}

                  {activeTab === 'comfyui' && hasComfyuiItems && (
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        bgcolor: 'background.default',
                        maxHeight: '100%',
                        overflow: 'auto'
                      }}
                    >
                      {comfyuiItems.map((item, idx) => (
                        <Typography
                          key={idx}
                          variant="body2"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.85em',
                            py: 0.5,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                            '&:hover': {
                              bgcolor: 'action.hover'
                            },
                            '&:last-child': { borderBottom: 'none' }
                          }}
                          onClick={() => onCopy(item.content)}
                        >
                          {item.content}
                        </Typography>
                      ))}
                    </Paper>
                  )}

                  {activeTab === 'nai' && hasNaiItems && (
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        bgcolor: 'background.default',
                        maxHeight: '100%',
                        overflow: 'auto'
                      }}
                    >
                      {naiItems.map((item, idx) => (
                        <Typography
                          key={idx}
                          variant="body2"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.85em',
                            py: 0.5,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                            '&:hover': {
                              bgcolor: 'action.hover'
                            },
                            '&:last-child': { borderBottom: 'none' }
                          }}
                          onClick={() => onCopy(item.content)}
                        >
                          {item.content}
                        </Typography>
                      ))}
                    </Paper>
                  )}
                </Box>
              </>
            ) : (
              // 탭이 필요없는 경우 (단일 컨텐츠만 있음)
              <Box sx={{ flex: 1, overflow: 'auto' }}>
                {hasChildren ? (
                  <Stack spacing={1}>
                    {sortedChildren.map((child) => (
                      <Card
                        key={child.id}
                        variant="outlined"
                        sx={{
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          '&:hover': {
                            bgcolor: 'action.hover',
                            borderColor: 'primary.main'
                          }
                        }}
                        onClick={() => onChildClick?.(child)}
                      >
                        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                            {child.children && child.children.length > 0 ? (
                              <FolderIcon fontSize="small" color="warning" />
                            ) : (
                              <FileIcon fontSize="small" color="info" />
                            )}
                            <Typography variant="body1" sx={{ flex: 1, fontFamily: 'monospace' }}>
                              {child.type === 'chain' ? child.name : `++${child.name}++`}
                            </Typography>
                            {child.children && child.children.length > 0 && (
                              <Chip
                                label={`${child.children.length} sub`}
                                size="small"
                                variant="outlined"
                              />
                            )}
                            {child.items && child.items.length > 0 && (
                              <Chip
                                label={`${child.items.filter(i => i.tool === 'comfyui').length} items`}
                                size="small"
                                color="primary"
                                variant="outlined"
                              />
                            )}
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCopy(child.type === 'chain' ? child.name : `++${child.name}++`);
                              }}
                              title={t('common:copy') || 'Copy'}
                            >
                              <CopyIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </CardContent>
                      </Card>
                    ))}
                  </Stack>
                ) : hasComfyuiItems ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      bgcolor: 'background.default',
                      maxHeight: 400,
                      overflow: 'auto'
                    }}
                  >
                    {comfyuiItems.map((item, idx) => (
                      <Typography
                        key={idx}
                        variant="body2"
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.85em',
                          py: 0.5,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s',
                          '&:hover': {
                            bgcolor: 'action.hover'
                          },
                          '&:last-child': { borderBottom: 'none' }
                        }}
                        onClick={() => onCopy(item.content)}
                      >
                        {item.content}
                      </Typography>
                    ))}
                  </Paper>
                ) : hasNaiItems ? (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      bgcolor: 'background.default',
                      maxHeight: 400,
                      overflow: 'auto'
                    }}
                  >
                    {naiItems.map((item, idx) => (
                      <Typography
                        key={idx}
                        variant="body2"
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.85em',
                          py: 0.5,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s',
                          '&:hover': {
                            bgcolor: 'action.hover'
                          },
                          '&:last-child': { borderBottom: 'none' }
                        }}
                        onClick={() => onCopy(item.content)}
                      >
                        {item.content}
                      </Typography>
                    ))}
                  </Paper>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('wildcards:autoCollect.noItems') || 'No items'}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        </>
      ) : (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Typography variant="body1" color="text.secondary">
            {emptyMessage || t('wildcards:autoCollect.selectWildcard') || 'Select a wildcard from the tree'}
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
