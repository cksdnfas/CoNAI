import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  Divider,
  CircularProgress
} from '@mui/material';
import { Security, VpnKey } from '@mui/icons-material';
import { authApi } from '../../../../services/authApi';
import { useAuth } from '../../../../contexts/AuthContext';

export const AuthSettings: React.FC = () => {
  const { hasCredentials, checkAuth } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Setup form state
  const [setupUsername, setSetupUsername] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');

  // Update form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const clearSetupForm = () => {
    setSetupUsername('');
    setSetupPassword('');
    setSetupConfirmPassword('');
  };

  const clearUpdateForm = () => {
    setCurrentPassword('');
    setNewUsername('');
    setNewPassword('');
    setConfirmNewPassword('');
  };

  const handleSetup = async () => {
    clearMessages();

    if (!setupUsername || !setupPassword) {
      setError('Username and password are required');
      return;
    }

    if (setupPassword !== setupConfirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.setup(setupUsername, setupPassword);
      setSuccess('Authentication configured successfully! You will need to login on your next visit.');
      clearSetupForm();
      await checkAuth(); // Refresh auth status
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || 'Failed to setup authentication');
      } else {
        setError('Failed to setup authentication');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async () => {
    clearMessages();

    if (!currentPassword || !newUsername || !newPassword) {
      setError('All fields are required');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.updateCredentials(currentPassword, newUsername, newPassword);
      setSuccess('Credentials updated successfully!');
      clearUpdateForm();
      await checkAuth(); // Refresh auth status
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || 'Failed to update credentials');
      } else {
        setError('Failed to update credentials');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={clearMessages}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={clearMessages}>
          {success}
        </Alert>
      )}

      {!hasCredentials ? (
        // Initial Setup Form
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Security sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Setup Authentication</Typography>
          </Box>

          <Alert severity="info" sx={{ mb: 3 }}>
            Configure username and password to protect your image manager from unauthorized access.
            Once set, you will need to login to access the application.
          </Alert>

          <TextField
            fullWidth
            label="Username"
            value={setupUsername}
            onChange={(e) => setSetupUsername(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            type="password"
            label="Password"
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            type="password"
            label="Confirm Password"
            value={setupConfirmPassword}
            onChange={(e) => setSetupConfirmPassword(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 3 }}
          />

          <Button
            variant="contained"
            onClick={handleSetup}
            disabled={isLoading || !setupUsername || !setupPassword || !setupConfirmPassword}
            fullWidth
          >
            {isLoading ? <CircularProgress size={24} /> : 'Setup Authentication'}
          </Button>
        </Paper>
      ) : (
        // Update Credentials Form
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <VpnKey sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Change Credentials</Typography>
          </Box>

          <Alert severity="warning" sx={{ mb: 3 }}>
            Changing your credentials will require you to login again with the new credentials.
          </Alert>

          <TextField
            fullWidth
            type="password"
            label="Current Password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 2 }}
          />

          <Divider sx={{ my: 2 }} />

          <TextField
            fullWidth
            label="New Username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            type="password"
            label="New Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            type="password"
            label="Confirm New Password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 3 }}
          />

          <Button
            variant="contained"
            onClick={handleUpdate}
            disabled={isLoading || !currentPassword || !newUsername || !newPassword || !confirmNewPassword}
            fullWidth
          >
            {isLoading ? <CircularProgress size={24} /> : 'Update Credentials'}
          </Button>
        </Paper>
      )}
    </Box>
  );
};
