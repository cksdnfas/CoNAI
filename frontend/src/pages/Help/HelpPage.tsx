import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  CircularProgress,
  Alert,
  useMediaQuery,
  useTheme,
  IconButton,
} from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

interface HelpSection {
  id: string;
  title: string;
  file: string;
}

const HelpPage: React.FC = () => {
  const { t, i18n } = useTranslation(['navigation', 'common']);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [selectedSection, setSelectedSection] = useState<string>('setup');
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(!isMobile);

  // 도움말 섹션 목록
  const sections: HelpSection[] = [
    { id: 'setup', title: t('navigation:help.sections.setup', '설정 가이드'), file: 'setup.md' },
    { id: 'filters', title: t('navigation:help.sections.filters', '필터 가이드'), file: 'filters.md' },
  ];

  // Markdown 파일 로드
  useEffect(() => {
    const loadContent = async () => {
      setLoading(true);
      setError(null);

      try {
        const section = sections.find(s => s.id === selectedSection);
        if (!section) {
          throw new Error('Section not found');
        }

        const lang = i18n.language || 'ko';
        const response = await fetch(`/help/${lang}/${section.file}`);

        if (!response.ok) {
          // 언어별 파일이 없으면 한국어로 폴백
          const fallbackResponse = await fetch(`/help/ko/${section.file}`);
          if (!fallbackResponse.ok) {
            throw new Error('Help content not found');
          }
          const fallbackText = await fallbackResponse.text();
          setContent(fallbackText);
        } else {
          const text = await response.text();
          setContent(text);
        }
      } catch (err) {
        console.error('Failed to load help content:', err);
        setError(t('common:errors.loadFailed', '콘텐츠를 불러오는데 실패했습니다.'));
        setContent('');
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [selectedSection, i18n.language]);

  const handleSectionClick = (sectionId: string) => {
    setSelectedSection(sectionId);
    if (isMobile) {
      setDrawerOpen(false);
    }
  };

  const drawerContent = (
    <Box sx={{ width: 280, pt: 2 }}>
      <Typography variant="h6" sx={{ px: 2, mb: 2, fontWeight: 600 }}>
        {t('navigation:help.title', '도움말')}
      </Typography>
      <List>
        {sections.map((section) => (
          <ListItem key={section.id} disablePadding>
            <ListItemButton
              selected={selectedSection === section.id}
              onClick={() => handleSectionClick(section.id)}
            >
              <ListItemText primary={section.title} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
      {/* 사이드바 - Desktop */}
      {!isMobile && (
        <Drawer
          variant="permanent"
          sx={{
            width: 280,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: 280,
              boxSizing: 'border-box',
              position: 'relative',
              height: 'auto',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      {/* 사이드바 - Mobile */}
      {isMobile && (
        <Drawer
          variant="temporary"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ModalProps={{ keepMounted: true }}
        >
          {drawerContent}
        </Drawer>
      )}

      {/* 메인 콘텐츠 */}
      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        <Container maxWidth="lg">
          {/* 모바일 메뉴 버튼 */}
          {isMobile && (
            <IconButton
              onClick={() => setDrawerOpen(true)}
              sx={{ mb: 2 }}
              aria-label="Open menu"
            >
              <MenuIcon />
            </IconButton>
          )}

          {/* 로딩 상태 */}
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          )}

          {/* 에러 상태 */}
          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          {/* Markdown 콘텐츠 */}
          {!loading && !error && content && (
            <Paper
              elevation={0}
              sx={{
                p: 4,
                backgroundColor: theme.palette.mode === 'dark' ? 'background.paper' : 'background.default',
                '& h1': {
                  fontSize: '2rem',
                  fontWeight: 600,
                  mb: 2,
                  mt: 0,
                },
                '& h2': {
                  fontSize: '1.5rem',
                  fontWeight: 600,
                  mb: 2,
                  mt: 4,
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  pb: 1,
                },
                '& h3': {
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  mb: 1.5,
                  mt: 3,
                },
                '& p': {
                  mb: 2,
                  lineHeight: 1.7,
                },
                '& ul, & ol': {
                  mb: 2,
                  pl: 3,
                },
                '& li': {
                  mb: 1,
                },
                '& code': {
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '0.9em',
                  fontFamily: 'monospace',
                },
                '& pre': {
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                  padding: 2,
                  borderRadius: 1,
                  overflow: 'auto',
                  mb: 2,
                },
                '& pre code': {
                  backgroundColor: 'transparent',
                  padding: 0,
                },
                '& blockquote': {
                  borderLeft: `4px solid ${theme.palette.primary.main}`,
                  pl: 2,
                  ml: 0,
                  fontStyle: 'italic',
                  color: theme.palette.text.secondary,
                },
                '& table': {
                  width: '100%',
                  borderCollapse: 'collapse',
                  mb: 2,
                },
                '& th, & td': {
                  border: `1px solid ${theme.palette.divider}`,
                  padding: 1.5,
                  textAlign: 'left',
                },
                '& th': {
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                  fontWeight: 600,
                },
                '& img': {
                  maxWidth: '100%',
                  height: 'auto',
                  borderRadius: 1,
                  mb: 2,
                },
              }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeSanitize]}
              >
                {content}
              </ReactMarkdown>
            </Paper>
          )}
        </Container>
      </Box>
    </Box>
  );
};

export default HelpPage;
