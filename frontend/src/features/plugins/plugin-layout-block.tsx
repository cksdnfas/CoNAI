import type { GenerationLayoutSurface } from '@conai/shared'
import { PluginConnection } from './plugin-page'
import type { PluginLayoutBlock as PluginLayoutBlockContribution } from './plugin-generation'

const ignoreDirty = () => {}

/** A plugin page shown as one block of a generation layout; it reads and fills the screen's form through the SDK. */
export default function PluginLayoutBlock({ block, surface }: { block: PluginLayoutBlockContribution; surface: GenerationLayoutSurface }) {
  return (
    <section aria-label={block.page.title} className="min-w-0">
      <PluginConnection
        key={`${block.pluginId}/${block.version}/${block.page.id}`}
        pluginId={block.pluginId}
        pageId={block.page.id}
        fileIds=""
        projectId=""
        write={false}
        onDirty={ignoreDirty}
        embed={{ surface, height: block.height }}
      />
    </section>
  )
}
