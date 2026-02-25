import React from 'react';
import { Box, Container } from '@mui/material';
import Header from './Header';
import Footer from './Footer';

interface LayoutProps {
  children: React.ReactNode;
  maxWidth?: false | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disablePadding?: boolean;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  maxWidth = false,
  disablePadding = false
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        width: '100%',
      }}
    >
      <Header />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          py: disablePadding ? 0 : { xs: 2, sm: 3, md: 4 },
          px: disablePadding ? 0 : { xs: 2, sm: 3, md: 4 },
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {maxWidth === false ? (
          <Box sx={{ width: '100%', flex: 1 }}>
            {children}
          </Box>
        ) : (
          <Container
            maxWidth={maxWidth}
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              px: 0,
            }}
          >
            {children}
          </Container>
        )}
      </Box>

      <Footer />
    </Box>
  );
};

export default Layout;