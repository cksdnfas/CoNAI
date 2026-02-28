import React from 'react'
import { Separator } from '@/components/ui/separator'
import WatchedFoldersList from './components/WatchedFoldersList'
import BackgroundStatusMonitor from './BackgroundStatusMonitor'

const FolderSettings: React.FC = () => {
  return (
    <div className="space-y-4">
      <BackgroundStatusMonitor />
      <Separator />
      <WatchedFoldersList />
    </div>
  )
}

export default FolderSettings
