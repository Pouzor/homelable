import type { NodeData, NodeType } from '@/types'
import { THEMES, type ThemeId } from './themes'

export interface NodeColors {
  border: string
  background: string
  icon: string
}

// Derived from the default theme — kept for backward compatibility and tests
export const NODE_DEFAULT_COLORS: Record<NodeType, NodeColors> = Object.fromEntries(
  (Object.entries(THEMES.default.colors.nodeAccents) as [NodeType, { border: string; icon: string }][]).map(
    ([type, accent]) => [
      type,
      {
        border:     accent.border,
        background: type === 'groupRect' ? 'transparent' : THEMES.default.colors.nodeCardBackground,
        icon:       accent.icon,
      },
    ]
  )
) as Record<NodeType, NodeColors>

export function resolveNodeColors(
  data: Pick<NodeData, 'type' | 'custom_colors'>,
  themeId: ThemeId = 'default',
): NodeColors {
  const theme = THEMES[themeId] ?? THEMES.default
  const accent = theme.colors.nodeAccents[data.type] ?? theme.colors.nodeAccents.generic
  const defaults: NodeColors = {
    border:     accent.border,
    background: data.type === 'groupRect' ? 'transparent' : theme.colors.nodeCardBackground,
    icon:       accent.icon,
  }
  const custom = data.custom_colors
  return {
    border:     custom?.border     ?? defaults.border,
    background: custom?.background ?? defaults.background,
    icon:       custom?.icon       ?? defaults.icon,
  }
}
