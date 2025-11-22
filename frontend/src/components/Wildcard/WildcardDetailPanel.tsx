import { useState } from 'react';
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
  const [itemTab, setItemTab] = useState<'comfyui' | 'nai'>('comfyui');

  // 자식 노드 정렬
  const sortedChildren = selectedNode?.children && sortChildren
    ? [...selectedNode.children].sort(sortChildren)
    : selectedNode?.children || [];

  // ComfyUI / NAI 아이템 필터링
  const comfyuiItems = selectedNode?.items?.filter((i) => i.tool === 'comfyui') || [];
  const naiItems = selectedNode?.items?.filter((i) => i.tool === 'nai') || [];
  const hasNaiItems = naiItems.length > 0;

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
              onClick={() => onCopy(`++${selectedNode.name}++`)}
              title={t('common:copy') || 'Copy'}
            >
              <Typography variant="h5" sx={{ fontFamily: 'monospace' }}>
                ++{selectedNode.name}++
              </Typography>
              {selectedNode.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {selectedNode.description}
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <IconButton
                onClick={() => onCopy(`++${selectedNode.name}++`)}
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

          {/* Content: Children or Items */}
          {sortedChildren.length > 0 ? (
            // 자식이 있으면 자식 목록 표시
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                {t('wildcards:autoCollect.childCount', { count: sortedChildren.length }) || `${sortedChildren.length} children`}
              </Typography>
              <Stack spacing={1}>
                {sortedChildren.map((child) => (
                  <Card
                    key={child.id}
                    variant="outlined"
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' }
                    }}
                    onClick={() => onChildClick?.(child)}
                  >
                    <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                        {child.children && child.children.length > 0 ? (
                          <FolderIcon fontSize="small" color="warning" />
                        ) : (
                          <FileIcon fontSize="small" color="info" />
                        )}
                        <Typography variant="body1" sx={{ flex: 1 }}>++{child.name}++</Typography>
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
                            onCopy(`++${child.name}++`);
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
            </Box>
          ) : (
            // 자식이 없으면 items 상세 표시 또는 커스텀 컨텐츠
            <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
              {renderExtraContent ? (
                renderExtraContent(selectedNode)
              ) : (
                <>
                  {/* Tool Tabs */}
                  <Tabs
                    value={itemTab}
                    onChange={(_, newValue) => setItemTab(newValue)}
                    sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
                  >
                    <Tab
                      value="comfyui"
                      label={`ComfyUI: ${comfyuiItems.length}${t('wildcards:card.itemsCount')}`}
                      sx={{ minHeight: 40, py: 1 }}
                    />
                    {hasNaiItems && (
                      <Tab
                        value="nai"
                        label={`NAI: ${naiItems.length}${t('wildcards:card.itemsCount')}`}
                        sx={{ minHeight: 40, py: 1 }}
                      />
                    )}
                  </Tabs>

                  {/* Items Display */}
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      bgcolor: 'background.default',
                      maxHeight: 400,
                      overflow: 'auto',
                      mt: 2,
                      flex: 1
                    }}
                  >
                    {itemTab === 'comfyui' ? (
                      comfyuiItems.length > 0 ? (
                        comfyuiItems.map((item, idx) => (
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
                              '&:hover': {
                                bgcolor: 'action.hover'
                              },
                              '&:last-child': { borderBottom: 'none' }
                            }}
                            onClick={() => onCopy(item.content)}
                          >
                            {item.content}
                          </Typography>
                        ))
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {t('wildcards:autoCollect.noItems') || 'No items'}
                        </Typography>
                      )
                    ) : (
                      naiItems.length > 0 ? (
                        naiItems.map((item, idx) => (
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
                              '&:hover': {
                                bgcolor: 'action.hover'
                              },
                              '&:last-child': { borderBottom: 'none' }
                            }}
                            onClick={() => onCopy(item.content)}
                          >
                            {item.content}
                          </Typography>
                        ))
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {t('wildcards:autoCollect.noItems') || 'No items'}
                        </Typography>
                      )
                    )}
                  </Paper>
                </>
              )}
            </Box>
          )}
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
