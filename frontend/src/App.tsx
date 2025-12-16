import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SnackbarProvider } from 'notistack';

// i18n
import './i18n';

// 페이지 컴포넌트들
import HomePage from './pages/Home/HomePage';
import UploadPage from './pages/Upload/UploadPage';

import ImageGroupsPage from './pages/ImageGroups/ImageGroupsPage';
import ImageDetailPage from './pages/ImageDetail/ImageDetailPage';
import SettingsPage from './pages/Settings/SettingsPage';
import ImageGenerationPage from './pages/ImageGeneration/ImageGenerationPage';
import WorkflowFormPage from './pages/Workflows/WorkflowFormPage';
import WorkflowGeneratePage from './pages/Workflows/WorkflowGeneratePage';


// Auth 컴포넌트들
import { LoginPage } from './components/Auth/LoginPage';
import { ProtectedRoute } from './components/Auth/ProtectedRoute';

// 레이아웃 컴포넌트들
import { Layout } from './components/Layout';

// 컨텍스트
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';

// React Query 클라이언트 설정
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60000, // 1분 - 백엔드 갤러리 캐시와 동기화
      gcTime: 300000, // 5분 - 가비지 컬렉션 시간
      refetchOnWindowFocus: false, // 윈도우 포커스 시 자동 재요청 비활성화
      retry: 1, // 실패 시 1번만 재시도
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CssBaseline />
        <SnackbarProvider maxSnack={3} autoHideDuration={3000}>
          <Router>
            <AuthProvider>
              <Routes>
                {/* Login page (no auth required) */}
                <Route path="/login" element={<LoginPage />} />

                {/* Protected routes */}
                <Route
                  path="/*"
                  element={
                    <ProtectedRoute>
                      <Layout>
                        <Routes>
                          <Route path="/" element={<HomePage />} />

                          <Route path="/image-groups" element={<ImageGroupsPage />} />
                          <Route path="/upload" element={<UploadPage />} />
                          <Route path="/settings" element={<SettingsPage />} />

                          <Route path="/image/:compositeHash" element={<ImageDetailPage />} />
                          <Route path="/image-generation" element={<ImageGenerationPage />} />
                          <Route path="/image-generation/new" element={<WorkflowFormPage />} />
                          <Route path="/image-generation/:id/edit" element={<WorkflowFormPage />} />
                          <Route path="/image-generation/:id/generate" element={<WorkflowGeneratePage />} />
                        </Routes>
                      </Layout>
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </AuthProvider>
          </Router>
        </SnackbarProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;