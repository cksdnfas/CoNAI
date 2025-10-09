import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
} from '@mui/material';
import { groupPromptTerms, type GroupedPromptResult } from '../../utils/promptGrouping';

interface PromptDisplayProps {
  prompt?: string | null;
  negativePrompt?: string | null;
  maxHeight?: number | string;
  showLabels?: boolean;
  variant?: 'outlined' | 'elevation' | 'none';
  showGrouped?: boolean; // 그룹별 배지 표시 모드
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
}) => {
  const [tabValue, setTabValue] = useState(0);
  const [positiveGrouped, setPositiveGrouped] = useState<GroupedPromptResult | null>(null);
  const [negativeGrouped, setNegativeGrouped] = useState<GroupedPromptResult | null>(null);
  const [loading, setLoading] = useState(false);

  const hasPrompt = prompt && prompt.trim();
  const hasNegativePrompt = negativePrompt && negativePrompt.trim();

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

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
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

        {/* 미분류 프롬프트들 */}
        {data.unclassified_terms.length > 0 && (
          <Box sx={{ mb: 1.5 }}>
            <Typography
              variant="subtitle2"
              sx={{
                mb: 0.5,
                fontWeight: 600,
                color: 'text.secondary',
                fontSize: '0.9rem',
              }}
            >
              Unclassified
            </Typography>
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


  // 기존 모드 (텍스트 표시)
  if (!hasPrompt && !hasNegativePrompt) {
    return (
      <Box sx={{ py: 2, textAlign: 'center', height: containerHeight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          프롬프트 정보가 없습니다.
        </Typography>
      </Box>
    );
  }

  // 탭이 하나만 있는 경우 탭 없이 표시
  if (hasPrompt && !hasNegativePrompt) {
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
            로딩 중...
          </Typography>
        </Box>
      ) : positiveGrouped ? (
        renderGroupedPrompts(positiveGrouped, false)
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2" color="text.secondary">
            그룹 정보를 로드할 수 없습니다.
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
                프롬프트
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

  if (!hasPrompt && hasNegativePrompt) {
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
            로딩 중...
          </Typography>
        </Box>
      ) : negativeGrouped ? (
        renderGroupedPrompts(negativeGrouped, true)
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2" color="text.secondary">
            그룹 정보를 로드할 수 없습니다.
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
                네거티브 프롬프트
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

  // 둘 다 있는 경우 탭으로 표시
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
          <Tab
            label="긍정"
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
          <Tab
            label="부정"
            id="prompt-tab-1"
            aria-controls="prompt-tabpanel-1"
            sx={{
              minHeight: 48,
              color: 'error.main',
              '&.Mui-selected': {
                fontWeight: 600,
              },
            }}
          />
        </Tabs>

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <TabPanel value={tabValue} index={0}>
            {showGrouped ? (
              loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body2" color="text.secondary">
                    로딩 중...
                  </Typography>
                </Box>
              ) : positiveGrouped ? (
                renderGroupedPrompts(positiveGrouped, false)
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body2" color="text.secondary">
                    그룹 정보를 로드할 수 없습니다.
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

          <TabPanel value={tabValue} index={1}>
            {showGrouped ? (
              loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body2" color="text.secondary">
                    로딩 중...
                  </Typography>
                </Box>
              ) : negativeGrouped ? (
                renderGroupedPrompts(negativeGrouped, true)
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body2" color="text.secondary">
                    그룹 정보를 로드할 수 없습니다.
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