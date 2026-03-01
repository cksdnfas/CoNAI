import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from 'react-i18next'
import { GeneralSettingsPanel } from '@/features/settings/components/general-settings-panel'
import { TaggerSettingsPanel } from '@/features/settings/components/tagger-settings-panel'
import LegacyRatingScoreSettings from '@/features/settings/bridges/rating-score-settings'
import LegacySimilaritySettings from '@/features/settings/bridges/similarity-settings'
import LegacyFolderSettings from '@/features/settings/bridges/folder-settings'
import { AuthSettings as LegacyAuthSettings } from '@/features/settings/bridges/auth-settings'
import { ExternalApiSettings as LegacyExternalApiSettings } from '@/features/settings/bridges/external-api-settings'
import { CivitaiSettings as LegacyCivitaiSettings } from '@/features/settings/bridges/civitai-settings'
import { PromptExplorer as LegacyPromptExplorer } from '@/features/settings/bridges/prompt-explorer'
import {
  settingsApi as legacySettingsApi,
  type AppSettings as LegacyAppSettings,
  type GeneralSettings as LegacyGeneralSettingsType,
  type KaloscopeSettings as LegacyKaloscopeSettingsType,
  type MetadataExtractionSettings as LegacyMetadataExtractionSettings,
  type TaggerSettings as LegacyTaggerSettingsType,
  type ThumbnailSettings as LegacyThumbnailSettings,
} from '@/services/settings-api'

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const { t: tPrompt } = useTranslation('promptManagement')
  const [tabValue, setTabValue] = useState('general')
  const [promptTabValue, setPromptTabValue] = useState('positive')
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

  const handleUpdateKaloscopeSettings = async (kaloscopeSettings: Partial<LegacyKaloscopeSettingsType>) => {
    setError(null)
    setSuccessMessage(null)
    try {
      const updatedSettings = await legacySettingsApi.updateKaloscopeSettings(kaloscopeSettings)
      setSettings(updatedSettings)
      showSaved()
    } catch (updateError) {
      setError(t('messages.saveFailed'))
      console.error('Failed to update kaloscope settings:', updateError)
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

  const sectionTitleMap: Record<string, string> = {
    folders: t('tabs.folders'),
    prompts: t('tabs.prompts'),
    rating: t('tabs.rating'),
    similarity: t('tabs.similarity'),
    account: t('tabs.account'),
    civitai: 'Civitai',
  }

  const renderSectionCard = (sectionKey: keyof typeof sectionTitleMap, content: ReactNode) => (
    <Card>
      <CardHeader>
        <CardTitle>{sectionTitleMap[sectionKey]}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )

  if (loading) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    )
  }

  if (error || !settings) {
    return (
      <div className="w-full">
        <UiAlert variant="destructive"><AlertDescription>{error || t('messages.loadFailed')}</AlertDescription></UiAlert>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="mb-4">
        <div className="mb-1 flex items-center">
          <Settings className="mr-2 h-8 w-8" />
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        </div>
      </div>

      {successMessage ? (
        <UiAlert className="mb-3 border-green-500/30 text-green-700"><AlertDescription>{successMessage}</AlertDescription></UiAlert>
      ) : null}

      <Tabs value={tabValue} onValueChange={setTabValue}>
              <TabsList className="mb-2 h-auto w-full flex-wrap justify-start gap-1 p-1">
                <TabsTrigger value="general">{t('tabs.general')}</TabsTrigger>
                <TabsTrigger value="folders">{t('tabs.folders')}</TabsTrigger>
                <TabsTrigger value="tagger">{t('tabs.tagger')}</TabsTrigger>
                <TabsTrigger value="prompts">{t('tabs.prompts')}</TabsTrigger>
                <TabsTrigger value="rating">{t('tabs.rating')}</TabsTrigger>
                <TabsTrigger value="similarity">{t('tabs.similarity')}</TabsTrigger>
                <TabsTrigger value="account">{t('tabs.account')}</TabsTrigger>
                <TabsTrigger value="civitai">Civitai</TabsTrigger>
              </TabsList>

      <TabsContent value="general">
              <GeneralSettingsPanel
                settings={settings.general}
                metadataSettings={settings.metadataExtraction}
                thumbnailSettings={settings.thumbnail}
                onUpdate={handleUpdateGeneralSettings}
                onMetadataUpdate={handleUpdateMetadataSettings}
                onThumbnailUpdate={handleUpdateThumbnailSettings}
              />
            </TabsContent>

      <TabsContent value="folders">
              {renderSectionCard('folders', <LegacyFolderSettings />)}
            </TabsContent>

      <TabsContent value="tagger">
              <TaggerSettingsPanel
                settings={settings.tagger}
                kaloscopeSettings={settings.kaloscope}
                onUpdate={handleUpdateTaggerSettings}
                onUpdateKaloscope={handleUpdateKaloscopeSettings}
              />
            </TabsContent>

      <TabsContent value="prompts">
              <Card>
                <CardContent className="pt-6">
                  <div className="w-full">
                    <Tabs value={promptTabValue} onValueChange={setPromptTabValue}>
                      <TabsList className="mb-2 h-auto w-full justify-start gap-1 p-1">
                        <TabsTrigger value="positive">{tPrompt('tabs.positive')}</TabsTrigger>
                        <TabsTrigger value="negative">{tPrompt('tabs.negative')}</TabsTrigger>
                        <TabsTrigger value="auto">{tPrompt('tabs.auto')}</TabsTrigger>
                      </TabsList>
                      <TabsContent value="positive"><LegacyPromptExplorer type="positive" /></TabsContent>
                      <TabsContent value="negative"><LegacyPromptExplorer type="negative" /></TabsContent>
                      <TabsContent value="auto"><LegacyPromptExplorer type="auto" /></TabsContent>
                    </Tabs>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

      <TabsContent value="rating">
              {renderSectionCard('rating', <LegacyRatingScoreSettings />)}
            </TabsContent>

      <TabsContent value="similarity">
              {renderSectionCard('similarity', <LegacySimilaritySettings />)}
            </TabsContent>

      <TabsContent value="account">
              {renderSectionCard('account', <LegacyAuthSettings />)}
            </TabsContent>

      <TabsContent value="civitai">
              {renderSectionCard('civitai', <><LegacyExternalApiSettings /><div className="mt-3"><LegacyCivitaiSettings /></div></>)}
            </TabsContent>
      </Tabs>
    </div>
  )
}
