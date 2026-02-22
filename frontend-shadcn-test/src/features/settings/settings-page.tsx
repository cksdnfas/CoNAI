import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, CircularProgress, Tab, Tabs, Typography } from '@mui/material'
import { Settings as SettingsIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import LegacyGeneralSettings from '@/legacy/pages/Settings/components/GeneralSettings'
import LegacyTaggerSettings from '@/legacy/pages/Settings/features/Tagger/TaggerSettings'
import LegacyRatingScoreSettings from '@/legacy/pages/Settings/features/Rating/RatingScoreSettings'
import LegacySimilaritySettings from '@/legacy/pages/Settings/features/Similarity/SimilaritySettings'
import LegacyFolderSettings from '@/legacy/pages/Settings/features/Folder/FolderSettings'
import { AuthSettings as LegacyAuthSettings } from '@/legacy/pages/Settings/features/Auth/AuthSettings'
import { ExternalApiSettings as LegacyExternalApiSettings } from '@/legacy/pages/Settings/features/ExternalApi/ExternalApiSettings'
import { CivitaiSettings as LegacyCivitaiSettings } from '@/legacy/pages/Settings/features/Civitai/CivitaiSettings'
import { PromptExplorer as LegacyPromptExplorer } from '@/legacy/features/PromptExplorer/PromptExplorer'
import {
  settingsApi as legacySettingsApi,
  type AppSettings as LegacyAppSettings,
  type GeneralSettings as LegacyGeneralSettingsType,
  type MetadataExtractionSettings as LegacyMetadataExtractionSettings,
  type TaggerSettings as LegacyTaggerSettingsType,
  type ThumbnailSettings as LegacyThumbnailSettings,
} from '@/services/settings-api'

interface TabPanelProps {
  children?: React.ReactNode
  index: number
  value: number
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return <div role="tabpanel" hidden={value !== index}>{value === index ? <Box sx={{ py: 3 }}>{children}</Box> : null}</div>
}

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const { t: tPrompt } = useTranslation('promptManagement')
  const [tabValue, setTabValue] = useState(0)
  const [promptTabValue, setPromptTabValue] = useState(0)
  const [settings, setSettings] = useState<LegacyAppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const loadedSettings = await legacySettingsApi.getSettings()
      setSettings(loadedSettings)
    } catch (loadError) {
      setError(t('messages.loadFailed'))
      console.error('Failed to load settings:', loadError)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const showSaved = () => {
    setSuccessMessage(t('messages.saveSuccess'))
    window.setTimeout(() => {
      setSuccessMessage(null)
    }, 3000)
  }

  const handleUpdateGeneralSettings = async (generalSettings: Partial<LegacyGeneralSettingsType>) => {
    setError(null)
    setSuccessMessage(null)
    try {
      const updatedSettings = await legacySettingsApi.updateGeneralSettings(generalSettings)
      setSettings(updatedSettings)
      showSaved()
    } catch (updateError) {
      setError(t('messages.saveFailed'))
      console.error('Failed to update settings:', updateError)
      throw updateError
    }
  }

  const handleUpdateTaggerSettings = async (taggerSettings: Partial<LegacyTaggerSettingsType>) => {
    setError(null)
    setSuccessMessage(null)
    try {
      const updatedSettings = await legacySettingsApi.updateTaggerSettings(taggerSettings)
      setSettings(updatedSettings)
      showSaved()
    } catch (updateError) {
      setError(t('messages.saveFailed'))
      console.error('Failed to update settings:', updateError)
      throw updateError
    }
  }

  const handleUpdateMetadataSettings = async (metadataSettings: Partial<LegacyMetadataExtractionSettings>) => {
    setError(null)
    setSuccessMessage(null)
    try {
      const updatedSettings = await legacySettingsApi.updateMetadataSettings(metadataSettings)
      setSettings(updatedSettings)
      showSaved()
    } catch (updateError) {
      setError(t('messages.saveFailed'))
      console.error('Failed to update settings:', updateError)
      throw updateError
    }
  }

  const handleUpdateThumbnailSettings = async (thumbnailSettings: Partial<LegacyThumbnailSettings>) => {
    setError(null)
    setSuccessMessage(null)
    try {
      const updatedSettings = await legacySettingsApi.updateThumbnailSettings(thumbnailSettings)
      setSettings(updatedSettings)
      showSaved()
    } catch (updateError) {
      setError(t('messages.saveFailed'))
      console.error('Failed to update settings:', updateError)
      throw updateError
    }
  }

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue)
  }

  if (loading) {
    return (
      <Box sx={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error || !settings) {
    return (
      <Box sx={{ width: '100%' }}>
        <Alert severity="error">{error || t('messages.loadFailed')}</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <SettingsIcon sx={{ mr: 1, fontSize: 32 }} />
          <Typography variant="h4" component="h1">
            {t('title')}
          </Typography>
        </Box>
      </Box>

      {successMessage ? (
        <Alert severity="success" sx={{ mb: 3 }}>
          {successMessage}
        </Alert>
      ) : null}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tabValue} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
          <Tab label={t('tabs.general')} />
          <Tab label={t('tabs.folders')} />
          <Tab label={t('tabs.tagger')} />
          <Tab label={t('tabs.prompts')} />
          <Tab label={t('tabs.rating')} />
          <Tab label={t('tabs.similarity')} />
          <Tab label={t('tabs.account')} />
          <Tab label="Civitai" />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        <LegacyGeneralSettings
          settings={settings.general}
          metadataSettings={settings.metadataExtraction}
          thumbnailSettings={settings.thumbnail}
          onUpdate={handleUpdateGeneralSettings}
          onMetadataUpdate={handleUpdateMetadataSettings}
          onThumbnailUpdate={handleUpdateThumbnailSettings}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <LegacyFolderSettings />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <LegacyTaggerSettings settings={settings.tagger} onUpdate={handleUpdateTaggerSettings} />
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <Box sx={{ width: '100%', mt: -2 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
            <Tabs
              value={promptTabValue}
              onChange={(_event, newValue) => setPromptTabValue(newValue)}
              aria-label="prompt management tabs"
              variant="scrollable"
              scrollButtons="auto"
              sx={{ px: 2 }}
            >
              <Tab label={tPrompt('tabs.positive')} />
              <Tab label={tPrompt('tabs.negative')} />
              <Tab label={tPrompt('tabs.auto')} />
            </Tabs>
          </Box>

          <Box>
            {promptTabValue === 0 ? <LegacyPromptExplorer type="positive" /> : null}
            {promptTabValue === 1 ? <LegacyPromptExplorer type="negative" /> : null}
            {promptTabValue === 2 ? <LegacyPromptExplorer type="auto" /> : null}
          </Box>
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={4}>
        <LegacyRatingScoreSettings />
      </TabPanel>

      <TabPanel value={tabValue} index={5}>
        <LegacySimilaritySettings />
      </TabPanel>

      <TabPanel value={tabValue} index={6}>
        <LegacyAuthSettings />
      </TabPanel>

      <TabPanel value={tabValue} index={7}>
        <LegacyExternalApiSettings />
        <Box sx={{ mt: 3 }}>
          <LegacyCivitaiSettings />
        </Box>
      </TabPanel>
    </Box>
  )
}
