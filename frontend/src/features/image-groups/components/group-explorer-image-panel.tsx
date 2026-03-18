import type { ReactNode } from 'react'

interface GroupExplorerImagePanelProps {
  title: string
  description: string
  content: ReactNode
}

export function GroupExplorerImagePanel({ title, description, content }: GroupExplorerImagePanelProps) {
  if (!content) {
    return (
      <div className="mb-3 rounded-lg border border-dashed bg-muted/10 px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    )
  }

  return <>{content}</>
}
