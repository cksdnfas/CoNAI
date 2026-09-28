import type { SVGProps } from 'react'

/*
 * Monochrome provider marks from lobe-icons (@lobehub/icons-static-svg 1.95.1, MIT).
 * They draw with currentColor so they follow the theme and the active-tab colour.
 * The marks themselves are trademarks of NovelAI (Anlatan), OpenAI and Comfy Org.
 */

type ProviderIconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function ProviderSvg({ children, className, ...props }: ProviderIconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true" focusable="false" className={className ?? 'size-4'} {...props}>
      {children}
    </svg>
  )
}

export function NovelAIIcon(props: ProviderIconProps) {
  return (
    <ProviderSvg {...props}>
      <path clipRule="evenodd" d="M5.861 18.918c-.829-1.368-1.838-2.504-3.04-3.289a.74.74 0 01-.18-1.045C4.817 11.764 8.199 4.378 9.97.359c.264-.601 1.17-.4 1.17.256v10.71a2.719 2.719 0 00-1.35 3.611l-3.935 3.982h.006zm.871 1.678c.415.924.763 1.92 1.04 2.948a.605.605 0 00.582.456h7.748a.61.61 0 00.583-.456 19.585 19.585 0 011.039-2.948l-2.06-2.085-1.718 1.738c.042.158.066.323.066.493 0 .997-.799 1.805-1.784 1.805a1.795 1.795 0 01-1.784-1.805c0-.997.799-1.806 1.784-1.806.15 0 .3.019.438.055l1.736-1.757-.979-.99a2.68 2.68 0 01-2.378 0l-4.3 4.352h-.013zm11.863-1.678c.829-1.368 1.838-2.504 3.04-3.289a.74.74 0 00.18-1.045C19.64 11.764 16.257 4.378 14.485.359c-.264-.601-1.17-.4-1.17.256v10.71a2.719 2.719 0 011.35 3.611l3.935 3.982h-.006z" />
    </ProviderSvg>
  )
}

export function CodexIcon(props: ProviderIconProps) {
  return (
    <ProviderSvg {...props}>
      <path clipRule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z" />
    </ProviderSvg>
  )
}

export function ComfyUIIcon(props: ProviderIconProps) {
  return (
    <ProviderSvg {...props}>
      <path d="M5.485 23.76c-.568 0-1.026-.207-1.325-.598-.307-.402-.387-.964-.22-1.54l.672-2.315a.605.605 0 00-.1-.536.622.622 0 00-.494-.243H2.085c-.568 0-1.026-.207-1.325-.598-.307-.403-.387-.964-.22-1.54l2.31-7.917.255-.87c.343-1.18 1.592-2.14 2.786-2.14h2.313c.276 0 .519-.18.595-.442l.764-2.633C9.906 1.208 11.155.249 12.35.249l4.945-.008h3.62c.568 0 1.027.206 1.325.597.307.402.387.964.22 1.54l-1.035 3.566c-.343 1.178-1.593 2.137-2.787 2.137l-4.956.01H11.37a.618.618 0 00-.594.441l-1.928 6.604a.605.605 0 00.1.537c.118.153.3.243.495.243l3.275-.006h3.61c.568 0 1.026.206 1.325.598.307.402.387.964.22 1.54l-1.036 3.565c-.342 1.179-1.592 2.138-2.786 2.138l-4.957.01h-3.61z" />
    </ProviderSvg>
  )
}

export type GenerationProviderKey = 'novelai' | 'nai' | 'codex' | 'comfyui'

/** Pick the mark for a provider / service key (history rows, queue rows, tabs). */
export function ProviderIcon({ provider, ...props }: ProviderIconProps & { provider: GenerationProviderKey | string }) {
  if (provider === 'novelai' || provider === 'nai') return <NovelAIIcon {...props} />
  if (provider === 'codex') return <CodexIcon {...props} />
  if (provider === 'comfyui') return <ComfyUIIcon {...props} />
  return null
}
