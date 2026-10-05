import {
  Anchor, Angry, AtSign, Baby, Beer, Bell, Bird, Book, BookOpen, Bookmark, Bot, Brain, Brush, Building2, Cake, Calendar, Camera, Car, Cat,
  Clapperboard, Clock, Cloud, CloudRain, Code, Coffee, Compass, Crown, Dice5, Dog, Drama, Eye, EyeOff, Feather, Film, Filter, Fish, Flag, Flame,
  Flower2, Frown, Gamepad2, Gem, Ghost, Gift, Globe, GraduationCap, Hash, Headphones, Heart, House, Image as ImageIcon, Key, Languages, Laugh, Leaf, Library,
  Lightbulb, ListChecks, ListOrdered, Lock, Map as MapIcon, Medal, MessageCircle, MessagesSquare, Mic, Moon, Mountain, Music, Palette, PenTool, Pencil,
  Plane, Puzzle, Quote, Rabbit, Repeat, Rocket, Ruler, Scissors, Search, Settings, Shield, ShoppingBag, Shuffle, Skull, Smile, Snowflake,
  Sparkles, Star, Store, Sun, Swords, Tag, Target, Terminal, Timer, TreePine, Trophy, Type, Umbrella, User, Users, Utensils, WandSparkles,
  Waves, Wine, Wrench, Zap, type LucideIcon,
} from 'lucide-react'

/** Built-in flag icons, stored as `lucide:<key>`; grouped so the picker reads as a few short rows of related icons. */
export const CHAT_FLAG_ICON_GROUPS: Array<{ label: { ko: string; en: string }; icons: Record<string, LucideIcon> }> = [
  {
    label: { ko: '그림·창작', en: 'Art' },
    icons: { palette: Palette, image: ImageIcon, camera: Camera, brush: Brush, 'pen-tool': PenTool, pencil: Pencil, wand: WandSparkles, sparkles: Sparkles, film: Film, clapperboard: Clapperboard, drama: Drama, feather: Feather },
  },
  {
    label: { ko: '말·글', en: 'Words' },
    icons: { message: MessageCircle, messages: MessagesSquare, quote: Quote, languages: Languages, type: Type, 'list-checks': ListChecks, 'list-ordered': ListOrdered, book: Book, 'book-open': BookOpen, library: Library, bookmark: Bookmark, hash: Hash, at: AtSign, mic: Mic },
  },
  {
    label: { ko: '감정', en: 'Mood' },
    icons: { heart: Heart, smile: Smile, laugh: Laugh, frown: Frown, angry: Angry, ghost: Ghost, skull: Skull, flame: Flame, zap: Zap, star: Star, crown: Crown, gem: Gem },
  },
  {
    label: { ko: '날씨·자연', en: 'Nature' },
    icons: { sun: Sun, moon: Moon, cloud: Cloud, rain: CloudRain, snow: Snowflake, leaf: Leaf, flower: Flower2, tree: TreePine, mountain: Mountain, waves: Waves, umbrella: Umbrella, anchor: Anchor },
  },
  {
    label: { ko: '생활', en: 'Life' },
    icons: { coffee: Coffee, utensils: Utensils, cake: Cake, wine: Wine, beer: Beer, gift: Gift, house: House, building: Building2, store: Store, bag: ShoppingBag, car: Car, plane: Plane, rocket: Rocket, map: MapIcon, compass: Compass, globe: Globe },
  },
  {
    label: { ko: '놀이', en: 'Play' },
    icons: { gamepad: Gamepad2, dice: Dice5, puzzle: Puzzle, swords: Swords, shield: Shield, trophy: Trophy, medal: Medal, target: Target, music: Music, headphones: Headphones },
  },
  {
    label: { ko: '사람·동물', en: 'Beings' },
    icons: { user: User, users: Users, baby: Baby, bot: Bot, cat: Cat, dog: Dog, bird: Bird, fish: Fish, rabbit: Rabbit, brain: Brain },
  },
  {
    label: { ko: '도구', en: 'Tools' },
    icons: { search: Search, eye: Eye, 'eye-off': EyeOff, filter: Filter, lightbulb: Lightbulb, key: Key, lock: Lock, bell: Bell, clock: Clock, timer: Timer, calendar: Calendar, flag: Flag, tag: Tag, shuffle: Shuffle, repeat: Repeat, ruler: Ruler, scissors: Scissors, wrench: Wrench, settings: Settings, code: Code, terminal: Terminal, graduation: GraduationCap },
  },
]

const ICONS_BY_KEY: Record<string, LucideIcon> = Object.assign({}, ...CHAT_FLAG_ICON_GROUPS.map((group) => group.icons))

/** Emoji offered next to the icons (any other emoji can be typed in). */
export const CHAT_FLAG_EMOJI = [
  '🎨', '🖼️', '📷', '✏️', '🎬', '🎭', '✂️', '📝', '💬', '🗯️', '🔎', '🧠', '💡', '📚', '🌐', '🗺️',
  '❤️', '😊', '😂', '😢', '😡', '😱', '🥰', '😈', '👻', '💀', '🔥', '⚡', '⭐', '✨', '💎', '👑',
  '☀️', '🌙', '🌧️', '❄️', '🌸', '🍀', '🌊', '⛰️', '☕', '🍰', '🍷', '🎁', '🏠', '🚀', '🎮', '🎲',
  '⚔️', '🛡️', '🏆', '🎯', '🎵', '🎧', '🐱', '🐶', '🐰', '🦊', '🤖', '👤', '👥', '🔒', '⏰', '🚩',
]

export const LUCIDE_PREFIX = 'lucide:'

export function chatFlagLucideIcon(icon: string): LucideIcon | null {
  return icon.startsWith(LUCIDE_PREFIX) ? ICONS_BY_KEY[icon.slice(LUCIDE_PREFIX.length)] ?? null : null
}
