export interface Pack {
  id: string;
  name: string;
  files: Map<string, ArrayBuffer>;
  color: string;
}

export interface TextureEntry {
  path: string;
  displayName: string;
  folder: string;
}

export type FolderSources = Record<string, string>;
export type TextureOverrides = Record<string, string>;

export const PACK_COLORS = [
  "#4ade80", "#60a5fa", "#f87171", "#fbbf24",
  "#a78bfa", "#34d399", "#f472b6", "#38bdf8",
];

export const MC_FOLDERS: { key: string; label: string; icon: string }[] = [
  { key: "blocks",      label: "Blocks",        icon: "🧱" },
  { key: "items",       label: "Items",         icon: "🗡️" },
  { key: "gui",         label: "GUI",           icon: "📋" },
  { key: "entity",      label: "Entity",        icon: "🐄" },
  { key: "particle",    label: "Particles",     icon: "✨" },
  { key: "environment", label: "Environment",   icon: "🌤️" },
  { key: "font",        label: "Font",          icon: "🔤" },
  { key: "misc",        label: "Misc",          icon: "📦" },
  { key: "map",         label: "Map",           icon: "🗺️" },
  { key: "colormap",    label: "Colormap",      icon: "🎨" },
  { key: "models",      label: "Models",        icon: "📐" },
  { key: "sounds",      label: "Sounds",        icon: "🔊" },
  { key: "lang",        label: "Language",      icon: "🌐" },
];
