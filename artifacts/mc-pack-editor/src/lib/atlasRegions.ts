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
export const ATLAS_DEFINITIONS: AtlasDefinition[] = [
  {
    pathSuffix: "gui/icons.png",
    label: "HUD Icons Atlas",
    regions: [
      {
        id: "hearts",
        label: "Hearts",
        x: 0, y: 0, w: 256, h: 27,
        description: "Health hearts, crosshair & armor row",
      },
      {
        id: "hunger",
        label: "Hunger",
        x: 0, y: 27, w: 256, h: 27,
        description: "Hunger & food poisoning sprites",
      },
      {
        id: "xpbar",
        label: "XP Bar",
        x: 0, y: 64, w: 256, h: 9,
        description: "Experience bar fill & background",
      },
      {
        id: "crosshair",
        label: "Crosshair",
        x: 0, y: 0, w: 16, h: 16,
        description: "Center-screen crosshair sprite",
      },
      {
        id: "armor",
        label: "Armor",
        x: 0, y: 9, w: 52, h: 9,
        description: "Armor point sprites",
      },
    ],
  },
  {
    pathSuffix: "gui/widgets.png",
    label: "Widget Atlas",
    regions: [
      {
        id: "hotbar",
        label: "Hotbar",
        x: 0, y: 0, w: 182, h: 22,
        description: "Hotbar background bar",
      },
      {
        id: "selected_slot",
        label: "Selected Slot",
        x: 0, y: 22, w: 24, h: 24,
        description: "Selected hotbar slot highlight",
      },
      {
        id: "buttons",
        label: "Buttons",
        x: 0, y: 46, w: 200, h: 20,
        description: "UI button sprites (normal, hover, disabled)",
      },
    ],
  },
];

export function getAtlasDefinition(path: string): AtlasDefinition | undefined {
  return ATLAS_DEFINITIONS.find(
    (def) => path === def.pathSuffix || path.endsWith(`/${def.pathSuffix}`)
  );
}
