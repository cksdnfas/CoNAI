import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  CircularProgress,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { groupPromptTerms, type GroupedPromptResult } from '../../utils/promptGrouping';
import type { AutoTagsData, ImageRecord } from '../../types/image';
import AutoTagDisplay from './AutoTagDisplay';

interface PromptDisplayProps {
  prompt?: string | null;
  negativePrompt?: string | null;
  maxHeight?: number | string;
  showLabels?: boolean;
  variant?: 'outlined' | 'elevation' | 'none';
  showGrouped?: boolean; // 그룹별 배지 표시 모드
  // AUTO 탭 관련 props
  imageId?: string;  // ✅ composite_hash
  autoTags?: AutoTagsData | null;
  isTaggerEnabled?: boolean;
  onAutoTagGenerated?: () => void;
  // 히스토리 컨텍스트 관련 props
  isHistoryContext?: boolean;
  linkedImage?: ImageRecord | null;
  loadingLinkedImage?: boolean;
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
      id={`prompt-tabpanel-${index}`}
      aria-labelledby={`prompt-tab-${index}`}
      {...other}
      style={{
        height: value === index ? '100%' : '0',
        flex: value === index ? '1 1 0%' : '0 0 0%',
        display: value === index ? 'flex' : 'none',
        flexDirection: 'column'
      }}
    >
      {value === index && (
        <Box sx={{ p: 1, height: '100%', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const PromptDisplay: React.FC<PromptDisplayProps> = ({
  prompt,
  negativePrompt,
  maxHeight,
  showLabels = true,
  variant = 'outlined',
  showGrouped = false,
  imageId,
  autoTags,
  isTaggerEnabled = false,
  onAutoTagGenerated,
  isHistoryContext = false,
  linkedImage = null,
  loadingLinkedImage = false,
}) => {
  const { t } = useTranslation('promptManagement');
  const [tabValue, setTabValue] = useState(0);
  const [positiveGrouped, setPositiveGrouped] = useState<GroupedPromptResult | null>(null);
  const [negativeGrouped, setNegativeGrouped] = useState<GroupedPromptResult | null>(null);
  const [loading, setLoading] = useState(false);

  // 사용자가 선택한 탭 종류 추적 (이미지 변경 시 동일한 종류 탭으로 이동)
  const previousTabTypeRef = React.useRef<'positive' | 'negative' | 'auto'>('positive');

  const hasPrompt = prompt && prompt.trim();
  const hasNegativePrompt = negativePrompt && negativePrompt.trim();

  // AUTO 탭 표시 조건: 일반 모드는 isTaggerEnabled, 히스토리 모드는 linkedImage 존재 여부
  const showAutoTab = isHistoryContext
    ? (linkedImage !== null || loadingLinkedImage)
    : (isTaggerEnabled && imageId !== undefined);

  // showGrouped가 true일 때 프롬프트 그룹화 처리
  useEffect(() => {
    if (showGrouped) {
      const loadGroupedData = async () => {
        setLoading(true);
        try {
          if (hasPrompt) {
            const positiveResult = await groupPromptTerms(prompt, 'positive');
            setPositiveGrouped(positiveResult);
          }
          if (hasNegativePrompt) {
            const negativeResult = await groupPromptTerms(negativePrompt, 'negative');
            setNegativeGrouped(negativeResult);
          }
        } catch (error) {
          console.error('Error grouping prompts:', error);
        } finally {
          setLoading(false);
        }
      };

      loadGroupedData();
    } else {
      setPositiveGrouped(null);
      setNegativeGrouped(null);
    }
  }, [showGrouped, prompt, negativePrompt, hasPrompt, hasNegativePrompt]);

  // 이미지 변경 시 이전에 선택했던 탭 종류를 찾아서 이동 (없으면 첫 번째로)
  useEffect(() => {
    const targetType = previousTabTypeRef.current;
    let index = 0;

    // 이전에 선택했던 탭 종류 찾기
    if (hasPrompt) {
      if (targetType === 'positive') {
        setTabValue(index);
        return;
      }
      index++;
    }

    if (hasNegativePrompt) {
      if (targetType === 'negative') {
        setTabValue(index);
        return;
      }
      index++;
    }

    if (showAutoTab) {
      if (targetType === 'auto') {
        setTabValue(index);
        return;
      }
    }

    // 이전 탭 종류를 찾지 못하면 첫 번째 탭으로
    setTabValue(0);
  }, [prompt, negativePrompt, linkedImage, hasPrompt, hasNegativePrompt, showAutoTab]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);

    // 현재 선택한 탭 종류를 ref에 저장
    let index = 0;

    if (hasPrompt) {
      if (newValue === index) {
        previousTabTypeRef.current = 'positive';
        return;
      }
      index++;
    }

    if (hasNegativePrompt) {
      if (newValue === index) {
        previousTabTypeRef.current = 'negative';
        return;
      }
      index++;
    }

    if (showAutoTab) {
      if (newValue === index) {
        previousTabTypeRef.current = 'auto';
      }
    }
  };

  // 그룹화된 프롬프트 렌더링 함수
  const renderGroupedPrompts = (data: GroupedPromptResult, isNegative: boolean = false) => {
    return (
      <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
        {/* 분류된 그룹들 */}
        {data.groups.map((group) => (
          <Box key={group.id} sx={{ mb: 1.5 }}>
            <Typography
              variant="subtitle2"
              sx={{
                mb: 0.5,
                fontWeight: 600,
                color: isNegative ? 'error.main' : 'primary.main',
                fontSize: '0.9rem',
              }}
            >
              {group.group_name}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                lineHeight: 1.6,
                wordBreak: 'break-word',
                color: 'text.primary',
              }}
            >
              {group.terms.join(', ')}
            </Typography>
          </Box>
        ))}

        {/* 미분류 프롬프트들 - 헤더 없이 표시 */}
        {data.unclassified_terms.length > 0 && (
          <Box sx={{ mb: 1.5 }}>
            <Typography
              variant="body2"
              sx={{
                lineHeight: 1.6,
                wordBreak: 'break-word',
                color: 'text.secondary',
              }}
            >
              {data.unclassified_terms.join(', ')}
            </Typography>
          </Box>
        )}
      </Box>
    );
  };

  // 높이 설정 - maxHeight가 없으면 100% 사용
  const containerHeight = maxHeight || '100%';


  // 프롬프트와 AUTO 탭 모두 없는 경우
  if (!hasPrompt && !hasNegativePrompt && !showAutoTab) {
    return (
      <Box sx={{ py: 2, textAlign: 'center', height: containerHeight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {t('promptDisplay.noPrompt')}
        </Typography>
      </Box>
    );
  }

  // 탭이 하나만 있는 경우 탭 없이 표시 (AUTO 탭이 없을 때만)
  if (hasPrompt && !hasNegativePrompt && !showAutoTab) {
    const containerSx = {
      height: '100%',
      borderRadius: variant === 'none' ? 0 : 2,
      display: 'flex',
      flexDirection: 'column'
    };

    const content = showGrouped ? (
      loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2" color="text.secondary">
            {t('promptDisplay.loading')}
          </Typography>
        </Box>
      ) : positiveGrouped ? (
        renderGroupedPrompts(positiveGrouped, false)
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2" color="text.secondary">
            {t('promptDisplay.loadFailed')}
          </Typography>
        </Box>
      )
    ) : (
      <Box
            sx={{
              flex: 1,
              p: 2,
              overflowY: 'auto',
              minHeight: 0,
              '&::-webkit-scrollbar': {
                width: '6px',
              },
              '&::-webkit-scrollbar-track': {
                background: 'transparent',
              },
              '&::-webkit-scrollbar-thumb': {
                background: 'rgba(0,0,0,0.2)',
                borderRadius: '3px',
                '&:hover': {
                  background: 'rgba(0,0,0,0.3)',
                },
              },
            }}
          >
            {showLabels && (
              <Typography
                variant="subtitle2"
                gutterBottom
                sx={{
                  fontWeight: 600,
                  color: 'primary.main',
                  mb: 1,
                }}
              >
                {t('promptDisplay.labels.prompt')}
              </Typography>
            )}
            <Typography
              variant="body2"
              sx={{
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
                wordBreak: 'break-word',
              }}
            >
              {prompt}
            </Typography>
          </Box>
    );

    return (
      <Box sx={{ height: containerHeight, width: '100%', display: 'flex', flexDirection: 'column' }}>
        {variant === 'none' ? (
          <Box sx={containerSx}>
            {content}
          </Box>
        ) : (
          <Paper variant={variant} sx={containerSx}>
            {content}
          </Paper>
        )}
      </Box>
    );
  }

  if (!hasPrompt && hasNegativePrompt && !showAutoTab) {
    const containerSx = {
      height: '100%',
      borderRadius: variant === 'none' ? 0 : 2,
      display: 'flex',
      flexDirection: 'column'
    };

    const content = showGrouped ? (
      loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2" color="text.secondary">
            {t('promptDisplay.loading')}
          </Typography>
        </Box>
      ) : negativeGrouped ? (
        renderGroupedPrompts(negativeGrouped, true)
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2" color="text.secondary">
            {t('promptDisplay.loadFailed')}
          </Typography>
        </Box>
      )
    ) : (
      <Box
            sx={{
              flex: 1,
              p: 2,
              overflowY: 'auto',
              minHeight: 0,
              '&::-webkit-scrollbar': {
                width: '6px',
              },
              '&::-webkit-scrollbar-track': {
                background: 'transparent',
              },
              '&::-webkit-scrollbar-thumb': {
                background: 'rgba(0,0,0,0.2)',
                borderRadius: '3px',
                '&:hover': {
                  background: 'rgba(0,0,0,0.3)',
                },
              },
            }}
          >
            {showLabels && (
              <Typography
                variant="subtitle2"
                gutterBottom
                sx={{
                  fontWeight: 600,
                  color: 'error.main',
                  mb: 1,
                }}
              >
                {t('promptDisplay.labels.negativePrompt')}
              </Typography>
            )}
            <Typography
              variant="body2"
              sx={{
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
                wordBreak: 'break-word',
                color: 'text.secondary',
              }}
            >
              {negativePrompt}
            </Typography>
          </Box>
    );

    return (
      <Box sx={{ height: containerHeight, width: '100%', display: 'flex', flexDirection: 'column' }}>
        {variant === 'none' ? (
          <Box sx={containerSx}>
            {content}
          </Box>
        ) : (
          <Paper variant={variant} sx={containerSx}>
            {content}
          </Paper>
        )}
      </Box>
    );
  }

  // 여러 탭이 필요한 경우 탭으로 표시 (긍정+부정, 또는 AUTO 탭 포함)
  const containerSx = {
    height: '100%',
    borderRadius: variant === 'none' ? 0 : 2,
    display: 'flex',
    flexDirection: 'column'
  };

  const content = (
    <>
      <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="프롬프트 탭"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            flexShrink: 0,
            '& .MuiTabs-flexContainer': {
              height: 48,
            },
          }}
        >
          {hasPrompt && (
            <Tab
              label={t('promptDisplay.tabs.positive')}
              id="prompt-tab-0"
              aria-controls="prompt-tabpanel-0"
              sx={{
                minHeight: 48,
                color: 'primary.main',
                '&.Mui-selected': {
                  fontWeight: 600,
                },
              }}
            />
          )}
          {hasNegativePrompt && (
            <Tab
              label={t('promptDisplay.tabs.negative')}
              id={`prompt-tab-${hasPrompt ? 1 : 0}`}
              aria-controls={`prompt-tabpanel-${hasPrompt ? 1 : 0}`}
              sx={{
                minHeight: 48,
                color: 'error.main',
                '&.Mui-selected': {
                  fontWeight: 600,
                },
              }}
            />
          )}
          {showAutoTab && (
            <Tab
              label={t('promptDisplay.tabs.auto')}
              id={`prompt-tab-${(hasPrompt ? 1 : 0) + (hasNegativePrompt ? 1 : 0)}`}
              aria-controls={`prompt-tabpanel-${(hasPrompt ? 1 : 0) + (hasNegativePrompt ? 1 : 0)}`}
              sx={{
                minHeight: 48,
                color: 'info.main',
                '&.Mui-selected': {
                  fontWeight: 600,
                },
              }}
            />
          )}
        </Tabs>

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {hasPrompt && (
            <TabPanel value={tabValue} index={0}>
              {showGrouped ? (
              loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('promptDisplay.loading')}
                  </Typography>
                </Box>
              ) : positiveGrouped ? (
                renderGroupedPrompts(positiveGrouped, false)
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('promptDisplay.loadFailed')}
                  </Typography>
                </Box>
              )
            ) : (
              <Box
                sx={{
                  height: '100%',
                  overflowY: 'auto',
                  p: 2,
                  '&::-webkit-scrollbar': {
                    width: '6px',
                  },
                  '&::-webkit-scrollbar-track': {
                    background: 'transparent',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: '3px',
                    '&:hover': {
                      background: 'rgba(0,0,0,0.3)',
                    },
                  },
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.6,
                    wordBreak: 'break-word',
                  }}
                >
                  {prompt}
                </Typography>
              </Box>
            )}
            </TabPanel>
          )}

          {hasNegativePrompt && (
            <TabPanel value={tabValue} index={hasPrompt ? 1 : 0}>
            {showGrouped ? (
              loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('promptDisplay.loading')}
                  </Typography>
                </Box>
              ) : negativeGrouped ? (
                renderGroupedPrompts(negativeGrouped, true)
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('promptDisplay.loadFailed')}
                  </Typography>
                </Box>
              )
            ) : (
              <Box
                sx={{
                  height: '100%',
                  overflowY: 'auto',
                  p: 2,
                  '&::-webkit-scrollbar': {
                    width: '6px',
                  },
                  '&::-webkit-scrollbar-track': {
                    background: 'transparent',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: '3px',
                    '&:hover': {
                      background: 'rgba(0,0,0,0.3)',
                    },
                  },
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.6,
                    wordBreak: 'break-word',
                    color: 'text.secondary',
                  }}
                >
                  {negativePrompt}
                </Typography>
              </Box>
            )}
            </TabPanel>
          )}

          {showAutoTab && (
            <TabPanel value={tabValue} index={(hasPrompt ? 1 : 0) + (hasNegativePrompt ? 1 : 0)}>
              {isHistoryContext ? (
                // 히스토리 컨텍스트: linked image의 AUTO 태그 표시
                loadingLinkedImage ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                    <CircularProgress size={40} />
                    <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                      업로드된 이미지 정보 불러오는 중...
                    </Typography>
                  </Box>
                ) : linkedImage ? (
                  <AutoTagDisplay
                    imageId={linkedImage.composite_hash}
                    autoTags={linkedImage.auto_tags ?? null}
                    onTagGenerated={() => {}}
                  />
                ) : (
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                    <Typography variant="body2" color="text.secondary">
                      서버에 업로드된 이미지가 없습니다
                    </Typography>
                  </Box>
                )
              ) : (
                // 일반 컨텍스트: 기존 동작
                <AutoTagDisplay
                  imageId={imageId!}
                  autoTags={autoTags ?? null}
                  onTagGenerated={onAutoTagGenerated}
                />
              )}
            </TabPanel>
          )}
        </Box>
      </>
  );

  return (
    <Box sx={{ height: containerHeight, width: '100%', display: 'flex', flexDirection: 'column' }}>
      {variant === 'none' ? (
        <Box sx={containerSx}>
          {content}
        </Box>
      ) : (
        <Paper variant={variant} sx={containerSx}>
          {content}
        </Paper>
      )}
    </Box>
  );
};

export default PromptDisplay;