import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n
import './i18n';

// 페이지 컴포넌트들
import HomePage from './pages/Home/HomePage';
import UploadPage from './pages/Upload/UploadPage';
import GalleryPage from './pages/Gallery/GalleryPage';
import SearchPage from './pages/Search/SearchPage';
import ImageGroupsPage from './pages/ImageGroups/ImageGroupsPage';
import ImageDetailPage from './pages/ImageDetail/ImageDetailPage';
import SettingsPage from './pages/Settings/SettingsPage';
import ImageGenerationPage from './pages/ImageGeneration/ImageGenerationPage';
import WorkflowFormPage from './pages/Workflows/WorkflowFormPage';
import WorkflowGeneratePage from './pages/Workflows/WorkflowGeneratePage';
import HelpPage from './pages/Help/HelpPage';

// 레이아웃 컴포넌트들
import { Layout } from './components/Layout';

// 테마 컨텍스트
import { ThemeProvider } from './contexts/ThemeContext';

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
        <Router>
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/gallery" element={<GalleryPage />} />
              <Route path="/image-groups" element={<ImageGroupsPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/image/:compositeHash" element={<ImageDetailPage />} />
              <Route path="/image-generation" element={<ImageGenerationPage />} />
              <Route path="/image-generation/new" element={<WorkflowFormPage />} />
              <Route path="/image-generation/:id/edit" element={<WorkflowFormPage />} />
              <Route path="/image-generation/:id/generate" element={<WorkflowGeneratePage />} />
            </Routes>
          </Layout>
        </Router>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;