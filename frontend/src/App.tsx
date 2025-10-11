import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';

// 페이지 컴포넌트들
import UploadPage from './pages/Upload/UploadPage';
import GalleryPage from './pages/Gallery/GalleryPage';
import SearchPage from './pages/Search/SearchPage';
import ImageGroupsPage from './pages/ImageGroups/ImageGroupsPage';
import PromptManagementPage from './pages/PromptManagement/PromptManagementPage';
import ImageDetailPage from './pages/ImageDetail/ImageDetailPage';
import SettingsPage from './pages/Settings/SettingsPage';

// 레이아웃 컴포넌트들
import { Layout } from './components/Layout';

// 테마 컨텍스트
import { ThemeProvider } from './contexts/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <CssBaseline />
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/gallery" replace />} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/image-groups" element={<ImageGroupsPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/prompt-management" element={<PromptManagementPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/image/:id" element={<ImageDetailPage />} />
          </Routes>
        </Layout>
      </Router>
    </ThemeProvider>
  );
}

export default App;