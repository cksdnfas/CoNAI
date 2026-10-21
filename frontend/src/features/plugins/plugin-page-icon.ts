import {
  AudioLines, BookOpen, Bot, Box, Braces, Calendar, ChartColumn, Code, Database, Dices, FileText, Film, Fish, FlaskConical, Gamepad2, Globe,
  Hammer, Image, Layers, LayoutDashboard, ListChecks, Map as MapIcon, MessageCircle, Music, NotebookPen, Palette, Puzzle, Rocket, ScrollText,
  Search, Shapes, Sparkles, Star, Table, Terminal, Users, WandSparkles, Workflow, Wrench, type LucideIcon,
} from 'lucide-react'
import type { PluginPageIcon } from '@conai/shared'

const ICONS: Record<PluginPageIcon, LucideIcon> = {
  'audio-lines': AudioLines, 'book-open': BookOpen, bot: Bot, box: Box, braces: Braces, calendar: Calendar, 'chart-column': ChartColumn,
  code: Code, database: Database, dices: Dices, 'file-text': FileText, film: Film, fish: Fish, 'flask-conical': FlaskConical,
  'gamepad-2': Gamepad2, globe: Globe, hammer: Hammer, image: Image, layers: Layers, 'layout-dashboard': LayoutDashboard,
  'list-checks': ListChecks, map: MapIcon, 'message-circle': MessageCircle, music: Music, 'notebook-pen': NotebookPen, palette: Palette,
  puzzle: Puzzle, rocket: Rocket, 'scroll-text': ScrollText, search: Search, shapes: Shapes, sparkles: Sparkles, star: Star, table: Table,
  terminal: Terminal, users: Users, 'wand-sparkles': WandSparkles, workflow: Workflow, wrench: Wrench,
}

/** The icon a plugin page names in its manifest; pages without one, or a name added after this tab loaded, keep the puzzle. */
export function pluginPageIcon(icon: PluginPageIcon | undefined): LucideIcon {
  return (icon && ICONS[icon]) || Puzzle
}
