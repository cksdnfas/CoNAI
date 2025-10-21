import { useState, useEffect } from 'react';
import { Box, Button, ButtonGroup } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Help as HelpIcon } from '@mui/icons-material';
import NAILoginForm from './components/NAILoginForm';
import NAIImageGeneratorV2 from './components/NAIImageGeneratorV2';
import NAIPromptHelper from './components/NAIPromptHelper';

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
      id={`nai-tabpanel-${index}`}
      aria-labelledby={`nai-tab-${index}`}
      {...other}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
}

export default function NAITab() {
  const { t } = useTranslation(['imageGeneration']);
  const [searchParams, setSearchParams] = useSearchParams();
  const subtabParam = searchParams.get('subtab');
  const [currentSubTab, setCurrentSubTab] = useState(0);
  const [promptText, setPromptText] = useState('');

  const [token, setToken] = useState<string | null>(null);
  const [isTokenValid, setIsTokenValid] = useState(false);

  useEffect(() => {
    // 저장된 토큰 확인
    const savedToken = localStorage.getItem('nai_token');
    const expiresAt = localStorage.getItem('nai_token_expires');

    if (savedToken && expiresAt) {
      const isValid = new Date(expiresAt) > new Date();
      if (isValid) {
        setToken(savedToken);
        setIsTokenValid(true);
      } else {
        // 만료된 토큰 제거
        localStorage.removeItem('nai_token');
        localStorage.removeItem('nai_token_expires');
      }
    }
  }, []);

  useEffect(() => {
    if (subtabParam === 'helper') {
      setCurrentSubTab(1);
    } else {
      setCurrentSubTab(0);
    }
  }, [subtabParam]);

  const handleSubTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setCurrentSubTab(newValue);
    const currentParams = Object.fromEntries(searchParams.entries());
    if (newValue === 0) {
      const { subtab, ...rest } = currentParams;
      setSearchParams(rest);
    } else if (newValue === 1) {
      setSearchParams({ ...currentParams, subtab: 'helper' });
    }
  };

  const handleLoginSuccess = (accessToken: string) => {
    setToken(accessToken);
    setIsTokenValid(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('nai_token');
    localStorage.removeItem('nai_token_expires');
    setToken(null);
    setIsTokenValid(false);
  };

  const handlePromptAdd = (tag: string) => {
    setPromptText(prev => prev ? `${prev}, ${tag}` : tag);
  };

  const handlePromptReplace = (prompt: string) => {
    setPromptText(prompt);
  };

  if (!isTokenValid) {
    return <NAILoginForm onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <Box>
      {/* 서브탭 - 버튼 스타일 */}
      <Box sx={{ mb: 3 }}>
        <ButtonGroup variant="outlined" size="medium" sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant={currentSubTab === 0 ? 'contained' : 'outlined'}
            startIcon={<ImageIcon />}
            onClick={() => handleSubTabChange(null as any, 0)}
            sx={{ flex: 1 }}
          >
            {t('imageGeneration:nai.subtabs.generate')}
          </Button>
          <Button
            variant={currentSubTab === 1 ? 'contained' : 'outlined'}
            startIcon={<HelpIcon />}
            onClick={() => handleSubTabChange(null as any, 1)}
            sx={{ flex: 1 }}
          >
            {t('imageGeneration:nai.subtabs.helper')}
          </Button>
        </ButtonGroup>
      </Box>

      {/* 이미지 생성 탭 */}
      <TabPanel value={currentSubTab} index={0}>
        <NAIImageGeneratorV2
          token={token!}
          onLogout={handleLogout}
          externalPrompt={promptText}
          onPromptChange={setPromptText}
        />
      </TabPanel>

      {/* 프롬프트 도우미 탭 */}
      <TabPanel value={currentSubTab} index={1}>
        <NAIPromptHelper
          onPromptAdd={handlePromptAdd}
          onPromptReplace={handlePromptReplace}
        />
      </TabPanel>
    </Box>
  );
}
