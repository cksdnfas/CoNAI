import React, { useState, useEffect } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  useMediaQuery,
  useTheme as useMuiTheme,
  Divider,
  Tooltip,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Close as CloseIcon,
  Brightness4 as DarkIcon,
  Brightness7 as LightIcon,
  Home as HomeIcon,
  PhotoLibrary as GalleryIcon,
  Folder as FolderIcon,
  CloudUpload as UploadIcon,
  AutoAwesome as GenerationIcon,
  Settings as SettingsIcon,

} from '@mui/icons-material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme as useAppTheme } from '../../contexts/ThemeContext';
import { settingsApi } from '../../services/settingsApi';

const Header: React.FC = () => {
  const { t } = useTranslation('navigation');
  const location = useLocation();
  const theme = useMuiTheme();
  const { mode, toggleMode } = useAppTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isNarrow = useMediaQuery(theme.breakpoints.down('lg')); // Below 1200px
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [enableGallery, setEnableGallery] = useState(true);

  // Load settings to check if gallery is enabled
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await settingsApi.getSettings();
        setEnableGallery(settings.general.enableGallery ?? true);
      } catch (error) {
        console.error('Failed to load gallery setting:', error);
        // Default to enabled on error
        setEnableGallery(true);
      }
    };
    loadSettings();
  }, []);

  const allNavItems = [
    { label: t('header.menu.home'), path: '/', icon: HomeIcon, tooltip: t('header.tooltip.home') },
    { label: t('header.menu.imageGroups'), path: '/image-groups', icon: FolderIcon, tooltip: t('header.tooltip.imageGroups') },
    { label: t('header.menu.upload'), path: '/upload', icon: UploadIcon, tooltip: t('header.tooltip.upload') },
    { label: t('header.menu.imageGeneration'), path: '/image-generation', icon: GenerationIcon, tooltip: t('header.tooltip.imageGeneration') },
    { label: t('header.menu.settings'), path: '/settings', icon: SettingsIcon, tooltip: t('header.tooltip.settings') },
  ];

  // Logic simplified: no gallery option anymore
  const navItems = allNavItems;

  const handleMobileMenuToggle = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleMobileMenuClose = () => {
    setMobileMenuOpen(false);
  };

  const MobileDrawer = () => (
    <Drawer
      anchor="left"
      open={mobileMenuOpen}
      onClose={handleMobileMenuClose}
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 2,
        '& .MuiDrawer-paper': {
          width: 280,
          boxSizing: 'border-box',
        },
      }}
      ModalProps={{
        keepMounted: true, // Better mobile performance
      }}
    >
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" component="div">
          {t('header.title')}
        </Typography>
        <IconButton onClick={handleMobileMenuClose} aria-label={t('header.mobileMenu.close')}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />
      <List>
        {navItems.map((item) => {
          const IconComponent = item.icon;
          return (
            <ListItem key={item.path} disablePadding>
              <ListItemButton
                component={RouterLink}
                to={item.path}
                selected={location.pathname === item.path}
                onClick={handleMobileMenuClose}
              >
                <ListItemIcon>
                  <IconComponent />
                </ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
      <Divider />
      <List>
        <ListItem disablePadding>
          <ListItemButton onClick={toggleMode}>
            <ListItemIcon>
              {mode === 'dark' ? <LightIcon /> : <DarkIcon />}
            </ListItemIcon>
            <ListItemText
              primary={mode === 'dark' ? t('header.theme.light') : t('header.theme.dark')}
              secondary={t('header.theme.toggle')}
            />
          </ListItemButton>
        </ListItem>
      </List>
    </Drawer>
  );

  return (
    <>
      <AppBar position="static" elevation={1} sx={{ transition: 'all 0.3s ease' }}>
        <Toolbar sx={{ width: '100%', px: { xs: 1.5, sm: 3, md: 4 }, py: 1 }}>
          {/* 모바일 메뉴 버튼 */}
          {isMobile && (
            <IconButton
              edge="start"
              color="inherit"
              aria-label="menu"
              onClick={handleMobileMenuToggle}
              sx={{ mr: 1.5 }}
            >
              <MenuIcon />
            </IconButton>
          )}

          {/* 로고/타이틀 */}
          <Typography
            variant="h6"
            component="div"
            sx={{
              flexGrow: 1,
              fontWeight: 700,
              fontSize: { xs: '0.95rem', sm: '1.15rem' },
              letterSpacing: '0.5px',
            }}
          >
            {t('header.title')}
          </Typography>

          {/* 데스크톱 네비게이션 */}
          {!isMobile && (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', ml: 2 }}>
              {navItems.map((item) => {
                const IconComponent = item.icon;
                const isActive = location.pathname === item.path;

                return (
                  <Tooltip key={item.path} title={item.tooltip} arrow placement="bottom">
                    <IconButton
                      color="inherit"
                      component={RouterLink}
                      to={item.path}
                      sx={{
                        color: 'inherit',
                        fontSize: '1.5rem',
                        p: 1,
                        borderRadius: '8px',
                        transition: 'all 0.2s ease',
                        backgroundColor: isActive ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                        border: isActive ? '1px solid rgba(255, 255, 255, 0.3)' : 'none',
                        '&:hover': {
                          backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        },
                      }}
                    >
                      <IconComponent sx={{ fontSize: 22 }} />
                    </IconButton>
                  </Tooltip>
                );
              })}

              {/* 테마 토글 버튼 */}
              <Tooltip title={t('header.theme.toggle')} arrow placement="bottom">
                <IconButton
                  color="inherit"
                  onClick={toggleMode}
                  sx={{
                    fontSize: '1.5rem',
                    p: 1,
                    borderRadius: '8px',
                    transition: 'all 0.2s ease',
                    ml: 1,
                    '&:hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    },
                  }}
                >
                  {mode === 'dark' ? <LightIcon sx={{ fontSize: 22 }} /> : <DarkIcon sx={{ fontSize: 22 }} />}
                </IconButton>
              </Tooltip>
            </Box>
          )}

          {/* 모바일에서만 테마 토글 버튼 */}
          {isMobile && (
            <Tooltip title={t('header.theme.toggle')} arrow>
              <IconButton
                color="inherit"
                onClick={toggleMode}
                sx={{
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  },
                }}
              >
                {mode === 'dark' ? <LightIcon /> : <DarkIcon />}
              </IconButton>
            </Tooltip>
          )}
        </Toolbar>
      </AppBar>

      {/* 모바일 드로어 */}
      <MobileDrawer />
    </>
  );
};

export default Header;