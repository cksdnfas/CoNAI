import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';

// 페이지 컴포넌트들
import HomePage from './pages/Home/HomePage';
import UploadPage from './pages/Upload/UploadPage';
import GalleryPage from './pages/Gallery/GalleryPage';
import SearchPage from './pages/Search/SearchPage';
import ImageGroupsPage from './pages/ImageGroups/ImageGroupsPage';
import PromptManagementPage from './pages/PromptManagement/PromptManagementPage';
import ImageDetailPage from './pages/ImageDetail/ImageDetailPage';
import SettingsPage from './pages/Settings/SettingsPage';
import ComfyUIServersPage from './pages/ComfyUIServers/ComfyUIServersPage';
import WorkflowsPage from './pages/Workflows/WorkflowsPage';
import WorkflowFormPage from './pages/Workflows/WorkflowFormPage';
import WorkflowGeneratePage from './pages/Workflows/WorkflowGeneratePage';

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
            <Route path="/" element={<HomePage />} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/image-groups" element={<ImageGroupsPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/prompt-management" element={<PromptManagementPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/image/:id" element={<ImageDetailPage />} />
            <Route path="/comfyui-servers" element={<ComfyUIServersPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/workflows/new" element={<WorkflowFormPage />} />
            <Route path="/workflows/:id/edit" element={<WorkflowFormPage />} />
            <Route path="/workflows/:id/generate" element={<WorkflowGeneratePage />} />
          </Routes>
        </Layout>
      </Router>
    </ThemeProvider>
  );
}

export default App;