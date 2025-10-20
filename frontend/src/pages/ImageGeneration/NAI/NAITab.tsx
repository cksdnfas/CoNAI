import { useState, useEffect } from 'react';
import { Box } from '@mui/material';
import NAILoginForm from './components/NAILoginForm';
import NAIImageGeneratorV2 from './components/NAIImageGeneratorV2';

export default function NAITab() {
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

  return (
    <Box>
      {!isTokenValid ? (
        <NAILoginForm onLoginSuccess={handleLoginSuccess} />
      ) : (
        <NAIImageGeneratorV2 token={token!} onLogout={handleLogout} />
      )}
    </Box>
  );
}
