export interface AtlasRegion {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  description?: string;
}

export interface AtlasDefinition {
  pathSuffix: string;
  label: string;
  regions: AtlasRegion[];
}

// Regions are listed from largest to smallest so composition applies them
// in an order where smaller/more-specific regions win (applied last).
const ICONS_REGIONS: AtlasRegion[] = [
  { id: "crosshair", label: "Crosshair", x: 0, y: 0, w: 16, h: 16, description: "Center-screen crosshair" },
  { id: "heart_empty", label: "Heart (Empty)", x: 16, y: 0, w: 9, h: 9, description: "Empty heart icon" },
  { id: "heart_full", label: "Heart (Full)", x: 52, y: 0, w: 9, h: 9, description: "Full heart icon" },
  { id: "heart_half", label: "Heart (Half)", x: 61, y: 0, w: 9, h: 9, description: "Half heart icon" },
  { id: "armor_empty", label: "Armor (Empty)", x: 16, y: 9, w: 9, h: 9, description: "Empty armor icon" },
  { id: "armor_full", label: "Armor (Full)", x: 34, y: 9, w: 9, h: 9, description: "Full armor icon" },
  { id: "armor_half", label: "Armor (Half)", x: 25, y: 9, w: 9, h: 9, description: "Half armor icon" },
  { id: "hunger_empty", label: "Hunger (Empty)", x: 16, y: 27, w: 9, h: 9, description: "Empty hunger icon" },
  { id: "hunger_full", label: "Hunger (Full)", x: 52, y: 27, w: 9, h: 9, description: "Full hunger icon" },
  { id: "hunger_half", label: "Hunger (Half)", x: 61, y: 27, w: 9, h: 9, description: "Half hunger icon" },
  { id: "xp_bar_empty", label: "XP Bar (Empty)", x: 0, y: 64, w: 182, h: 5, description: "Experience bar background" },
  { id: "xp_bar_full", label: "XP Bar (Full)", x: 0, y: 69, w: 182, h: 5, description: "Experience bar fill" },
];

const WIDGETS_REGIONS: AtlasRegion[] = [
  { id: "hotbar_container", label: "Hotbar Container", x: 0, y: 0, w: 182, h: 22, description: "Hotbar bar" },
  { id: "active_selector", label: "Active Selector", x: 0, y: 22, w: 24, h: 24, description: "Selected slot highlight" },
  { id: "button_disabled", label: "Button (Disabled)", x: 0, y: 46, w: 200, h: 20, description: "Disabled button row" },
  { id: "button_normal", label: "Button (Normal)", x: 0, y: 66, w: 200, h: 20, description: "Normal button row" },
  { id: "button_hover", label: "Button (Hover)", x: 0, y: 86, w: 200, h: 20, description: "Hover button row" },
];

export const ATLAS_DEFINITIONS: AtlasDefinition[] = [
  { pathSuffix: "gui/icons.png", label: "HUD Icons Atlas", regions: ICONS_REGIONS },
  { pathSuffix: "textures/gui/icons.png", label: "HUD Icons Atlas", regions: ICONS_REGIONS },
  { pathSuffix: "gui/widgets.png", label: "Widget Atlas", regions: WIDGETS_REGIONS },
  { pathSuffix: "textures/gui/widgets.png", label: "Widget Atlas", regions: WIDGETS_REGIONS },
];

export function getAtlasDefinition(path: string): AtlasDefinition | undefined {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return ATLAS_DEFINITIONS.find((def) => {
    const suffix = def.pathSuffix.replace(/\\/g, "/").toLowerCase();
    return normalized === suffix || normalized.endsWith(`/${suffix}`) || normalized.endsWith(suffix);
  });
}
