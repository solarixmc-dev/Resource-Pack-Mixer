import JSZip from "jszip";
import { Pack, TextureEntry, PACK_COLORS } from "../types";
import { AtlasRegion, getAtlasDefinition } from "./atlasRegions";

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

async function readBitmap(buffer: ArrayBuffer): Promise<ImageBitmap> {
  const blob = new Blob([buffer], { type: "image/png" });
  return createImageBitmap(blob);
}

export async function cropAtlasRegion(
  buffer: ArrayBuffer,
  region: AtlasRegion
): Promise<ArrayBuffer> {
  const bitmap = await readBitmap(buffer);
  const canvas = document.createElement("canvas");
  canvas.width = region.w;
  canvas.height = region.h;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context is unavailable");

  ctx.clearRect(0, 0, region.w, region.h);
  ctx.drawImage(bitmap, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
  bitmap.close();

  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode cropped atlas region"));
        return;
      }
      blob.arrayBuffer().then(resolve).catch(reject);
    }, "image/png");
  });
}

export async function pasteAtlasRegion(
  targetBuffer: ArrayBuffer,
  patchBuffer: ArrayBuffer,
  region: AtlasRegion
): Promise<ArrayBuffer> {
  const targetBitmap = await readBitmap(targetBuffer);
  const patchBitmap = await readBitmap(patchBuffer);

  const canvas = document.createElement("canvas");
  canvas.width = targetBitmap.width;
  canvas.height = targetBitmap.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context is unavailable");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(targetBitmap, 0, 0);
  ctx.clearRect(region.x, region.y, region.w, region.h);
  ctx.drawImage(patchBitmap, 0, 0, region.w, region.h, region.x, region.y, region.w, region.h);

  targetBitmap.close();
  patchBitmap.close();

  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode stitched atlas region"));
        return;
      }
      blob.arrayBuffer().then(resolve).catch(reject);
    }, "image/png");
  });
}

export async function replaceAtlasRegion(
  targetBuffer: ArrayBuffer,
  sourceBuffer: ArrayBuffer,
  region: AtlasRegion
): Promise<ArrayBuffer> {
  const cropped = await cropAtlasRegion(sourceBuffer, region);
  return pasteAtlasRegion(targetBuffer, cropped, region);
}

/** Compose an atlas PNG by drawing region patches from other packs on top of a base atlas. */
export async function composeAtlas(
  baseBuffer: ArrayBuffer,
  patches: { region: AtlasRegion; buffer: ArrayBuffer }[]
): Promise<ArrayBuffer> {
  const baseBlob = new Blob([baseBuffer], { type: "image/png" });
  const baseBitmap = await createImageBitmap(baseBlob);

  const canvas = document.createElement("canvas");
  canvas.width = baseBitmap.width;
  canvas.height = baseBitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(baseBitmap, 0, 0);
  baseBitmap.close();

  for (const { region, buffer } of patches) {
    const patchBlob = new Blob([buffer], { type: "image/png" });
    const patchBitmap = await createImageBitmap(patchBlob);
    ctx.drawImage(
      patchBitmap,
      region.x, region.y, region.w, region.h,
      region.x, region.y, region.w, region.h
    );
    patchBitmap.close();
  }

  return new Promise<ArrayBuffer>((resolve) => {
    canvas.toBlob((blob) => blob!.arrayBuffer().then(resolve), "image/png");
  });
}

export async function exportMergedPack(
  packs: Pack[],
  folderSources: Record<string, string>,
  textureOverrides: Record<string, string>,
  atlasRegionOverrides: Record<string, Record<string, string>>,
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

      // If this is a known atlas with region-level overrides, compose it
      const atlasDef = getAtlasDefinition(path);
      const regionOverrides = atlasRegionOverrides[path];
      if (atlasDef && regionOverrides && Object.keys(regionOverrides).length > 0) {
        const patches: { region: AtlasRegion; buffer: ArrayBuffer }[] = [];
        const orderedRegions = [...atlasDef.regions].sort((a, b) => {
          const areaA = a.w * a.h;
          const areaB = b.w * b.h;
          return areaB - areaA;
        });
        for (const region of orderedRegions) {
          const overridePackId = regionOverrides[region.id];
          if (!overridePackId) continue;
          const overridePack = packs.find((p) => p.id === overridePackId && p.files.has(path));
          if (overridePack) {
            patches.push({ region, buffer: overridePack.files.get(path)! });
          }
        }
        if (patches.length > 0) {
          const composed = await composeAtlas(buf, patches);
          zip.file(path, composed);
          continue;
        }
      }

      zip.file(path, buf);
    }
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
