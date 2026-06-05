import JSZip from "jszip";
import { Pack, TextureEntry, PACK_COLORS } from "../types";

let packColorIndex = 0;

export async function loadPackFromFile(file: File): Promise<Pack> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const files = new Map<string, ArrayBuffer>();

  await Promise.all(
    Object.entries(zip.files).map(async ([path, entry]) => {
      if (!entry.dir) {
        const buf = await entry.async("arraybuffer");
        files.set(path, buf);
      }
    })
  );

  const color = PACK_COLORS[packColorIndex % PACK_COLORS.length];
  packColorIndex++;

  const name = file.name.replace(/\.zip$/i, "");
  return { id: crypto.randomUUID(), name, files, color };
}

export function getTextureFolder(path: string): string {
  // Normalize: strip leading slash
  const p = path.replace(/^\//, "");

  // assets/minecraft/textures/blocks/... -> blocks
  const texMatch = p.match(/assets\/\w+\/textures\/([^/]+)\//);
  if (texMatch) return texMatch[1];

  // assets/minecraft/models/block/... -> models
  const modelMatch = p.match(/assets\/\w+\/models\/([^/]+)\//);
  if (modelMatch) return "models";

  // assets/minecraft/sounds/... -> sounds
  if (p.match(/assets\/\w+\/sounds\//)) return "sounds";

  // assets/minecraft/lang/... -> lang
  if (p.match(/assets\/\w+\/lang\//)) return "lang";

  // assets/minecraft/blockstates/... -> blockstates
  if (p.match(/assets\/\w+\/blockstates\//)) return "blockstates";

  return "other";
}

export function getTexturesForFolder(pack: Pack, folder: string): TextureEntry[] {
  const entries: TextureEntry[] = [];

  pack.files.forEach((_, path) => {
    const f = getTextureFolder(path);
    if (f !== folder) return;

    // Only include image files and text/json for non-texture folders
    const isImage = /\.(png|jpg|jpeg|gif|tga)$/i.test(path);
    const isJson = /\.(json|mcmeta|txt)$/i.test(path);
    const isSounds = folder === "sounds" && /\.ogg$/i.test(path);
    const isLang = folder === "lang";

    if (!isImage && !isJson && !isSounds && !isLang) return;

    // Get display name
    const parts = path.split("/");
    const displayName = parts[parts.length - 1];

    entries.push({ path, displayName, folder });
  });

  return entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function getAllFoldersInPacks(packs: Pack[]): Set<string> {
  const folders = new Set<string>();
  for (const pack of packs) {
    pack.files.forEach((_, path) => {
      const f = getTextureFolder(path);
      if (f !== "other") folders.add(f);
    });
  }
  return folders;
}

export function getAllTexturePathsInFolder(packs: Pack[], folder: string): string[] {
  const paths = new Set<string>();
  for (const pack of packs) {
    getTexturesForFolder(pack, folder).forEach((e) => {
      paths.add(e.path);
    });
  }
  return Array.from(paths).sort();
}

export function arrayBufferToDataURL(buffer: ArrayBuffer, path: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);

  const ext = path.split(".").pop()?.toLowerCase() ?? "png";
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    tga: "image/x-tga",
  };
  const mime = mimeMap[ext] ?? "image/png";
  return `data:${mime};base64,${b64}`;
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpg|jpeg|gif)$/i.test(path);
}

export async function exportMergedPack(
  packs: Pack[],
  folderSources: Record<string, string>,
  textureOverrides: Record<string, string>,
  packName: string,
  packDescription: string,
  packIcon: string | null
): Promise<Blob> {
  const zip = new JSZip();

  // Collect all unique paths across all packs
  const allPaths = new Set<string>();
  for (const pack of packs) {
    pack.files.forEach((_, path) => allPaths.add(path));
  }

  // Write pack.mcmeta — preserve § codes in both name and description
  const mcmeta = JSON.stringify(
    { pack: { pack_format: 1, description: packDescription, name: packName } },
    null,
    2
  );
  zip.file("pack.mcmeta", mcmeta);

  // Write pack icon
  if (packIcon) {
    const b64 = packIcon.split(",")[1];
    if (b64) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      zip.file("pack.png", bytes);
    }
  }

  // For each file path, determine which pack to use
  for (const path of allPaths) {
    if (path === "pack.mcmeta" || path === "pack.png") continue;

    const folder = getTextureFolder(path);

    // Check texture-level override first, then folder source, then first pack that has it
    let sourcePack: Pack | undefined;

    const overridePackId = textureOverrides[path];
    if (overridePackId) {
      sourcePack = packs.find((p) => p.id === overridePackId && p.files.has(path));
    }

    if (!sourcePack) {
      const folderPackId = folderSources[folder];
      if (folderPackId) {
        sourcePack = packs.find((p) => p.id === folderPackId && p.files.has(path));
      }
    }

    if (!sourcePack) {
      // Use first pack that has this file
      sourcePack = packs.find((p) => p.files.has(path));
    }

    if (sourcePack) {
      const buf = sourcePack.files.get(path)!;
      zip.file(path, buf);
    }
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
