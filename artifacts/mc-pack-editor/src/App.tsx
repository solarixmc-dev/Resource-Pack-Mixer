import { useState, useCallback, useRef, useMemo, useEffect, DragEvent } from "react";
import { Pack, MC_FOLDERS, TextureOverrides, FolderSources } from "./types";
import {
  loadPackFromFile,
  getTexturesForFolder,
  getAllFoldersInPacks,
  getAllTexturePathsInFolder,
  getTextureFolder,
  arrayBufferToDataURL,
  isImagePath,
  exportMergedPack,
  composeAtlas,
} from "./lib/zipUtils";
import { getAtlasDefinition, AtlasDefinition } from "./lib/atlasRegions";

// ─── Small UI atoms ────────────────────────────────────────────────────────────

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
      style={{ background: color + "22", color, border: `1px solid ${color}55` }}
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function Btn({
  children,
  onClick,
  variant = "default",
  className = "",
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "ghost" | "danger" | "primary";
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const base =
    "inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none";
  const variants = {
    default: "bg-secondary text-secondary-foreground hover:bg-accent border border-border",
    ghost: "text-muted-foreground hover:text-foreground hover:bg-accent",
    danger: "bg-destructive text-destructive-foreground hover:opacity-90",
    primary: "bg-primary text-primary-foreground hover:opacity-90",
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

// ─── Color Picker ──────────────────────────────────────────────────────────────

const SWATCHES = [
  "#4ade80","#22c55e","#16a34a","#166534",
  "#60a5fa","#3b82f6","#2563eb","#1d4ed8",
  "#f87171","#ef4444","#dc2626","#b91c1c",
  "#fbbf24","#f59e0b","#d97706","#b45309",
  "#a78bfa","#8b5cf6","#7c3aed","#6d28d9",
  "#34d399","#10b981","#059669","#047857",
  "#f472b6","#ec4899","#db2777","#be185d",
  "#fb923c","#f97316","#ea580c","#c2410c",
  "#38bdf8","#0ea5e9","#0284c7","#0369a1",
  "#e879f9","#d946ef","#c026d3","#a21caf",
  "#94a3b8","#64748b","#ffffff","#000000",
];

function ColorPicker({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (c: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hexInput, setHexInput] = useState(value);

  // Keep local hex in sync when value changes from swatch/native picker
  useEffect(() => { setHexInput(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const handleHexChange = (v: string) => {
    setHexInput(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
  };

  return (
    <div
      ref={ref}
      className="absolute z-[60] mt-1 p-2 bg-card border border-border rounded-lg shadow-xl"
      style={{ width: 164 }}
    >
      <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => { onChange(c); onClose(); }}
            className="w-4 h-4 rounded-sm transition-transform hover:scale-125 focus:outline-none"
            style={{
              background: c,
              outline: c === value ? "2px solid white" : "none",
              outlineOffset: 1,
            }}
            title={c}
          />
        ))}
      </div>
      {/* Native color input + hex text */}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 rounded cursor-pointer border border-border bg-transparent p-0"
          title="Pick any color"
        />
        <input
          type="text"
          value={hexInput}
          onChange={(e) => handleHexChange(e.target.value)}
          className="flex-1 bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
          maxLength={7}
          placeholder="#ffffff"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ─── Pack Order Panel ──────────────────────────────────────────────────────────

function PackOrderPanel({
  packs,
  onReorder,
  onRemove,
  packVisibility,
  onVisibilityToggle,
}: {
  packs: Pack[];
  onReorder: (newOrder: Pack[]) => void;
  onRemove: (id: string) => void;
  packVisibility: Record<string, boolean>;
  onVisibilityToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  const handleDocClick = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, [handleDocClick]);

  const handleDragStart = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.dataTransfer.effectAllowed = "move";
    setDragIndex(index);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIndex(index);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...packs];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved);
    onReorder(next);
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const PRIORITY_LABELS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

  return (
    <div ref={containerRef} className="relative flex flex-col min-w-0">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-secondary hover:bg-accent text-sm font-medium transition-colors cursor-pointer select-none"
      >
        <span className="text-base">⇅</span>
        <span>Pack Priority</span>
        <div className="flex items-center gap-1 mx-1">
          {packs.map((p) => (
            <span
              key={p.id}
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: p.color }}
            />
          ))}
        </div>
        <span className="text-muted-foreground text-xs ml-auto">{open ? "▲" : "▼"}</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-72 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Auto priority order
            </span>
            <span className="text-xs text-muted-foreground">drag to reorder</span>
          </div>
          <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
            When set to <span className="text-primary font-medium">auto</span>, the first pack is preferred. Textures missing from it fall through to the next pack.
          </p>
          <div className="p-2 flex flex-col gap-1">
            {packs.map((pack, i) => {
              const isDragging = dragIndex === i;
              const isOver = overIndex === i && dragIndex !== null && dragIndex !== i;
              return (
                <div
                  key={pack.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={(e) => handleDrop(e, i)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-2 px-2 py-2 rounded border transition-all cursor-grab active:cursor-grabbing select-none
                    ${isDragging ? "opacity-40 border-primary" : "border-transparent hover:border-border hover:bg-accent/50"}
                    ${isOver ? "border-primary bg-primary/10" : ""}
                  `}
                >
                  {/* Drag handle */}
                  <span className="text-muted-foreground text-base leading-none flex-shrink-0">⋮⋮</span>

                  {/* Priority badge */}
                  <span
                    className="text-xs font-bold w-7 text-center flex-shrink-0 rounded py-0.5"
                    style={{ background: pack.color + "22", color: pack.color }}
                  >
                    {PRIORITY_LABELS[i] ?? `${i + 1}th`}
                  </span>

                  {/* Color dot (static) */}
                  <span
                    className="w-3.5 h-3.5 rounded-full flex-shrink-0 border border-white/20"
                    style={{ background: pack.color }}
                  />
                  <span className="text-sm text-foreground font-medium flex-1 truncate">
                    {pack.name}
                  </span>

                  {/* File count */}
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {pack.files.size.toLocaleString()} files
                  </span>

                  {/* Visibility toggle */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onVisibilityToggle(pack.id); }}
                    className={`text-base flex-shrink-0 transition-all leading-none ${packVisibility[pack.id] === false ? "opacity-25 grayscale" : "opacity-70 hover:opacity-100"}`}
                    title={packVisibility[pack.id] === false ? "Hidden from comparison — click to show" : "Visible in comparison — click to hide"}
                  >
                    👁
                  </button>

                  {/* Remove */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(pack.id); }}
                    className="text-muted-foreground hover:text-destructive text-sm transition-colors flex-shrink-0"
                    title="Remove pack"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Drop Zone ─────────────────────────────────────────────────────────────────

function DropZone({ onLoad }: { onLoad: (packs: Pack[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) =>
        f.name.toLowerCase().endsWith(".zip")
      );
      if (!arr.length) return;
      setLoading(true);
      try {
        const loaded = await Promise.all(arr.map(loadPackFromFile));
        onLoad(loaded);
      } catch (e) {
        console.error("Failed to load pack:", e);
      } finally {
        setLoading(false);
      }
    },
    [onLoad]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors
        ${dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-accent/30"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <div className="text-4xl">📦</div>
      {loading ? (
        <p className="text-sm text-muted-foreground animate-pulse">Loading packs…</p>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground">Drop resource pack ZIPs here</p>
          <p className="text-xs text-muted-foreground">or click to browse — multiple packs supported</p>
        </>
      )}
    </div>
  );
}

// ─── Minecraft text renderer ───────────────────────────────────────────────────

const MC_COLOR_MAP: Record<string, string> = {
  "0": "#000000", "1": "#0000AA", "2": "#00AA00", "3": "#00AAAA",
  "4": "#AA0000", "5": "#AA00AA", "6": "#FFAA00", "7": "#AAAAAA",
  "8": "#555555", "9": "#5555FF", "a": "#55FF55", "b": "#55FFFF",
  "c": "#FF5555", "d": "#FF55FF", "e": "#FFFF55", "f": "#FFFFFF",
};

interface McSegment {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

function parseMcText(raw: string): McSegment[] {
  const segments: McSegment[] = [];
  let color: string | undefined;
  let bold = false, italic = false, underline = false, strikethrough = false;

  // Split on § codes; keep delimiters
  const parts = raw.split(/(§[0-9a-fklmnorA-FKLMNOR])/);
  for (const part of parts) {
    if (part.startsWith("§") && part.length === 2) {
      const ch = part[1].toLowerCase();
      if (MC_COLOR_MAP[ch]) {
        color = MC_COLOR_MAP[ch];
        bold = italic = underline = strikethrough = false;
      } else if (ch === "l") { bold = true; }
      else if (ch === "o") { italic = true; }
      else if (ch === "n") { underline = true; }
      else if (ch === "m") { strikethrough = true; }
      else if (ch === "r") {
        color = undefined;
        bold = italic = underline = strikethrough = false;
      }
      // §k (obfuscated) intentionally ignored
    } else if (part) {
      segments.push({ text: part, color, bold, italic, underline, strikethrough });
    }
  }
  return segments;
}

function McText({ text, fallback = "—" }: { text: string; fallback?: string }) {
  const segments = parseMcText(text);
  if (!segments.length) {
    return <span className="text-muted-foreground italic text-xs">{fallback}</span>;
  }
  return (
    <>
      {segments.map((seg, i) => {
        const dec = [seg.underline && "underline", seg.strikethrough && "line-through"]
          .filter(Boolean).join(" ");
        return (
          <span
            key={i}
            style={{
              color: seg.color ?? "#FFFFFF",
              fontWeight: seg.bold ? "bold" : undefined,
              fontStyle: seg.italic ? "italic" : undefined,
              textDecoration: dec || undefined,
              textShadow: seg.color ? `1px 1px 2px rgba(0,0,0,0.8)` : undefined,
            }}
          >
            {seg.text}
          </span>
        );
      })}
    </>
  );
}

// ─── Minecraft format codes ────────────────────────────────────────────────────

const MC_COLORS = [
  { code: "§0", color: "#000000", label: "Black" },
  { code: "§1", color: "#0000AA", label: "Dark Blue" },
  { code: "§2", color: "#00AA00", label: "Dark Green" },
  { code: "§3", color: "#00AAAA", label: "Dark Aqua" },
  { code: "§4", color: "#AA0000", label: "Dark Red" },
  { code: "§5", color: "#AA00AA", label: "Dark Purple" },
  { code: "§6", color: "#FFAA00", label: "Gold" },
  { code: "§7", color: "#AAAAAA", label: "Gray" },
  { code: "§8", color: "#555555", label: "Dark Gray" },
  { code: "§9", color: "#5555FF", label: "Blue" },
  { code: "§a", color: "#55FF55", label: "Green" },
  { code: "§b", color: "#55FFFF", label: "Aqua" },
  { code: "§c", color: "#FF5555", label: "Red" },
  { code: "§d", color: "#FF55FF", label: "Light Purple" },
  { code: "§e", color: "#FFFF55", label: "Yellow" },
  { code: "§f", color: "#FFFFFF", label: "White" },
];

const MC_FORMATS = [
  { code: "§k", label: "Obf", title: "Obfuscated (§k)", style: {} },
  { code: "§l", label: "B",   title: "Bold (§l)",        style: { fontWeight: "bold" as const } },
  { code: "§m", label: "S",   title: "Strikethrough (§m)", style: { textDecoration: "line-through" } },
  { code: "§n", label: "U",   title: "Underline (§n)",   style: { textDecoration: "underline" } },
  { code: "§o", label: "I",   title: "Italic (§o)",      style: { fontStyle: "italic" as const } },
  { code: "§r", label: "R",   title: "Reset (§r)",       style: {} },
];

type UploadDefaults = {
  name: string;
  description: string;
  icon: string | null;
};

const DEFAULT_UPLOAD_DEFAULTS: UploadDefaults = {
  name: "My Resource Pack",
  description: "A Minecraft 1.8 Resource Pack",
  icon: null,
};

function readUploadDefaults(): UploadDefaults {
  if (typeof window === "undefined") return DEFAULT_UPLOAD_DEFAULTS;

  try {
    const saved = window.localStorage.getItem("mc-pack-editor-upload-defaults");
    if (!saved) return DEFAULT_UPLOAD_DEFAULTS;

    const parsed = JSON.parse(saved) as Partial<UploadDefaults>;
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : DEFAULT_UPLOAD_DEFAULTS.name,
      description: typeof parsed.description === "string" && parsed.description.trim()
        ? parsed.description
        : DEFAULT_UPLOAD_DEFAULTS.description,
      icon: typeof parsed.icon === "string" ? parsed.icon : null,
    };
  } catch {
    return DEFAULT_UPLOAD_DEFAULTS;
  }
}

// ─── Pack Settings ─────────────────────────────────────────────────────────────

function PackSettings({
  packName,
  packDescription,
  packIcon,
  onNameChange,
  onDescriptionChange,
  onIconChange,
}: {
  packName: string;
  packDescription: string;
  packIcon: string | null;
  onNameChange: (n: string) => void;
  onDescriptionChange: (d: string) => void;
  onIconChange: (d: string | null) => void;
}) {
  const iconRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const [activeField, setActiveField] = useState<"name" | "desc">("desc");

  const handleIcon = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => onIconChange(reader.result as string);
    reader.readAsDataURL(f);
  };

  const insertCode = (code: string) => {
    const ref = activeField === "name" ? nameRef : descRef;
    const onChange = activeField === "name" ? onNameChange : onDescriptionChange;
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newValue = el.value.slice(0, start) + code + el.value.slice(end);
    onChange(newValue);
    requestAnimationFrame(() => {
      el.setSelectionRange(start + code.length, start + code.length);
      el.focus();
    });
  };

  return (
    <div className="flex items-start gap-3">
      {/* Pack icon */}
      <button
        className="w-12 h-12 rounded border border-border flex-shrink-0 overflow-hidden checkered hover:border-primary transition-colors cursor-pointer mt-5"
        onClick={() => iconRef.current?.click()}
        title="Click to change pack icon"
      >
        {packIcon ? (
          <img src={packIcon} alt="icon" className="w-full h-full object-cover texture-preview" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xl">📦</div>
        )}
        <input ref={iconRef} type="file" accept="image/*" className="hidden" onChange={handleIcon} />
      </button>

      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        {/* Pack name */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Output Pack Name</label>
          <input
            ref={nameRef}
            type="text"
            value={packName}
            onFocus={() => setActiveField("name")}
            onChange={(e) => onNameChange(e.target.value)}
            className="bg-secondary border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-full font-mono"
            placeholder="My Resource Pack"
          />
          {packName.includes("§") && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-black rounded border border-border/50 text-sm min-h-[26px]">
              <McText text={packName} fallback="…" />
            </div>
          )}
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">
            Description <span className="opacity-60">(pack.mcmeta)</span>
          </label>
          <input
            ref={descRef}
            type="text"
            value={packDescription}
            onFocus={() => setActiveField("desc")}
            onChange={(e) => onDescriptionChange(e.target.value)}
            className="bg-secondary border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-full font-mono"
            placeholder="A Minecraft resource pack"
          />
          {packDescription.includes("§") && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-black rounded border border-border/50 text-sm min-h-[26px]">
              <McText text={packDescription} fallback="…" />
            </div>
          )}
        </div>

        {/* Format code toolbar */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground font-medium">Format codes</label>
            <span className="text-xs text-primary">
              → inserting into <span className="font-semibold">{activeField === "name" ? "Name" : "Description"}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1 p-1.5 bg-secondary/50 rounded border border-border overflow-y-auto" style={{ maxHeight: 72 }}>
            {/* Color codes */}
            {MC_COLORS.map(({ code, color, label }) => (
              <button
                key={code}
                onMouseDown={(e) => { e.preventDefault(); insertCode(code); }}
                className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold hover:scale-110 transition-transform flex-shrink-0 border border-white/10"
                style={{
                  background: color === "#000000" || color === "#555555" ? color : color,
                  color: ["#000000","#555555","#0000AA","#00AA00","#00AAAA","#AA0000","#AA00AA"].includes(color) ? "#fff" : "#000",
                }}
                title={`${label} (${code})`}
              >
                A
              </button>
            ))}
            {/* Separator */}
            <div className="w-px h-6 bg-border flex-shrink-0 mx-0.5" />
            {/* Format codes */}
            {MC_FORMATS.map(({ code, label, title, style }) => (
              <button
                key={code}
                onMouseDown={(e) => { e.preventDefault(); insertCode(code); }}
                className="px-2 h-6 rounded text-xs bg-muted hover:bg-accent text-foreground transition-colors flex-shrink-0 border border-border"
                style={style}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Folder Sidebar ────────────────────────────────────────────────────────────

function FolderSidebar({
  packs,
  selectedFolder,
  onSelect,
  folderSources,
  onFolderSource,
}: {
  packs: Pack[];
  selectedFolder: string;
  onSelect: (f: string) => void;
  folderSources: FolderSources;
  onFolderSource: (folder: string, packId: string | null) => void;
}) {
  const availableFolders = useMemo(() => getAllFoldersInPacks(packs), [packs]);

  const defined = MC_FOLDERS.filter((f) => availableFolders.has(f.key));
  const extra = Array.from(availableFolders)
    .filter((k) => !MC_FOLDERS.find((f) => f.key === k))
    .sort();

  const renderFolder = (key: string, label: string, icon: string) => {
    const sourcePackId = folderSources[key];
    const sourcePack = packs.find((p) => p.id === sourcePackId);
    const active = selectedFolder === key;

    return (
      <div key={key} className={`group rounded transition-colors ${active ? "bg-primary/15" : "hover:bg-accent/50"}`}>
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left"
          onClick={() => onSelect(key)}
        >
          <span className={`flex-1 font-medium leading-snug ${active ? "text-primary" : "text-foreground"}`}>
            {label}
          </span>
        </button>
        {packs.length > 1 && (
          <div className="px-3 pb-2 flex items-center gap-1 flex-wrap">
            <button
              className={`text-xs px-2 py-0.5 rounded transition-colors ${!sourcePackId ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
              onClick={(e) => { e.stopPropagation(); onFolderSource(key, null); }}
              title="Use highest-priority pack for each file"
            >
              auto
            </button>
            {packs.map((p) => (
              <button
                key={p.id}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${sourcePackId === p.id ? "font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                style={sourcePackId === p.id ? { background: p.color + "33", color: p.color } : {}}
                onClick={(e) => { e.stopPropagation(); onFolderSource(key, p.id); }}
                title={p.name}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav className="flex flex-col gap-0.5 py-2">
      {defined.map((f) => renderFolder(f.key, f.label, f.icon))}
      {extra.map((k) => renderFolder(k, k, "📁"))}
    </nav>
  );
}

// ─── Texture Card ──────────────────────────────────────────────────────────────

function TextureCard({
  texturePath,
  displayName,
  packs,
  folderSources,
  textureOverrides,
  folder,
  onOverride,
  onOpenLightbox,
}: {
  texturePath: string;
  displayName: string;
  packs: Pack[];
  folderSources: FolderSources;
  textureOverrides: TextureOverrides;
  folder: string;
  onOverride: (path: string, packId: string | null) => void;
  onOpenLightbox?: () => void;
}) {
  const overridePackId = textureOverrides[texturePath];
  const folderPackId = folderSources[folder];
  const effectivePackId = overridePackId ?? folderPackId;

  const packsWithFile = packs.filter((p) => p.files.has(texturePath));
  if (!packsWithFile.length) return null;

  const isImg = isImagePath(texturePath);
  const isAtlas = !!getAtlasDefinition(texturePath);

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden flex flex-col group hover:border-primary/40 transition-colors">
      {/* Texture previews row */}
      {isImg && (
        <div
          className={`flex border-b border-border ${packsWithFile.length === 1 ? "" : "divide-x divide-border"}`}
        >
          {packsWithFile.map((pack) => {
            const buf = pack.files.get(texturePath)!;
            const url = arrayBufferToDataURL(buf, texturePath);
            const isSelected =
              effectivePackId === pack.id ||
              (!effectivePackId && pack === packsWithFile[0]);
            return (
              <button
                key={pack.id}
                className={`flex-1 flex items-center justify-center p-2 checkered min-h-[80px] relative transition-all ${
                  packsWithFile.length > 1 ? "cursor-pointer hover:brightness-110" : "cursor-default"
                } ${isSelected && packsWithFile.length > 1 ? "ring-2 ring-inset ring-primary" : ""}`}
                onClick={() => {
                  if (packsWithFile.length <= 1) return;
                  if (overridePackId === pack.id) {
                    onOverride(texturePath, null);
                  } else {
                    onOverride(texturePath, pack.id);
                  }
                }}
                title={packsWithFile.length > 1 ? `Use from: ${pack.name}` : pack.name}
              >
                <img
                  src={url}
                  alt={displayName}
                  className="texture-preview max-w-[72px] max-h-[72px] object-contain"
                />
                {packsWithFile.length > 1 && (
                  <span
                    className="absolute bottom-1 right-1 w-2 h-2 rounded-full"
                    style={{ background: pack.color }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* File label & controls — click label to open lightbox */}
      <button
        className="px-2 py-1.5 flex items-center gap-1 min-w-0 w-full text-left hover:bg-accent/40 transition-colors"
        onClick={() => onOpenLightbox?.()}
        title="Click to view larger"
      >
        {isAtlas && (
          <span className="text-[10px] text-primary font-bold flex-shrink-0" title="Atlas texture — region editor available">ATL</span>
        )}
        <span className="text-xs text-muted-foreground truncate flex-1" title={displayName}>
          {displayName}
        </span>
        {overridePackId && (
          <span
            className="text-xs text-primary flex-shrink-0"
            onClick={(e) => { e.stopPropagation(); onOverride(texturePath, null); }}
            title="Clear override"
          >
            ✕
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">⊞</span>
      </button>

      {/* Pack selector (when multiple packs) */}
      {packsWithFile.length > 1 && (
        <div className="px-2 pb-2 flex gap-1 flex-wrap">
          <button
            className={`text-xs px-1.5 py-0.5 rounded transition-colors ${!overridePackId ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            onClick={() => onOverride(texturePath, null)}
          >
            auto
          </button>
          {packsWithFile.map((p) => (
            <button
              key={p.id}
              className={`text-xs px-1.5 py-0.5 rounded transition-colors truncate max-w-[60px] ${overridePackId === p.id ? "font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
              style={overridePackId === p.id ? { background: p.color + "33", color: p.color } : {}}
              onClick={() => onOverride(texturePath, overridePackId === p.id ? null : p.id)}
              title={p.name}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Texture Grid ──────────────────────────────────────────────────────────────

function TextureGrid({
  packs,
  folder,
  folderSources,
  textureOverrides,
  onOverride,
  onOpenLightbox,
  cols,
}: {
  packs: Pack[];
  folder: string;
  folderSources: FolderSources;
  textureOverrides: TextureOverrides;
  onOverride: (path: string, packId: string | null) => void;
  onOpenLightbox: (path: string, displayName: string, folder: string) => void;
  cols: number;
}) {
  const [search, setSearch] = useState("");

  const paths = useMemo(
    () => getAllTexturePathsInFolder(packs, folder),
    [packs, folder]
  );

  const filtered = useMemo(() => {
    if (!search) return paths;
    const q = search.toLowerCase();
    return paths.filter((p) => p.toLowerCase().includes(q));
  }, [paths, search]);

  if (!paths.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <p className="text-sm">No files in this folder across uploaded packs</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder="Search in folder…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-secondary border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 flex-1"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length}/{paths.length} files
        </span>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {filtered.map((path) => {
          const parts = path.split("/");
          const displayName = parts[parts.length - 1];
          return (
            <TextureCard
              key={path}
              texturePath={path}
              displayName={displayName}
              packs={packs}
              folderSources={folderSources}
              textureOverrides={textureOverrides}
              folder={folder}
              onOverride={onOverride}
              onOpenLightbox={() => onOpenLightbox(path, displayName, folder)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Search All Results ─────────────────────────────────────────────────────────

function SearchAllResults({
  query,
  packs,
  folderSources,
  textureOverrides,
  onOverride,
  onOpenLightbox,
  cols,
}: {
  query: string;
  packs: Pack[];
  folderSources: FolderSources;
  textureOverrides: TextureOverrides;
  onOverride: (path: string, packId: string | null) => void;
  onOpenLightbox: (path: string, displayName: string, folder: string) => void;
  cols: number;
}) {
  const allPaths = useMemo(() => {
    const set = new Set<string>();
    for (const pack of packs) {
      pack.files.forEach((_, p) => {
        if (p !== "pack.mcmeta" && p !== "pack.png") set.add(p);
      });
    }
    return [...set].sort();
  }, [packs]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return allPaths.filter((p) => p.toLowerCase().includes(q));
  }, [allPaths, query]);

  if (!filtered.length) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
        <span className="text-3xl">🔍</span>
        <p className="text-sm">No textures match <strong className="text-foreground">"{query}"</strong></p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {filtered.length} result{filtered.length !== 1 ? "s" : ""} across all folders
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {filtered.map((path) => {
          const parts = path.split("/");
          const displayName = parts[parts.length - 1];
          const folder = getTextureFolder(path);
          return (
            <div key={path} className="flex flex-col gap-0.5">
              <TextureCard
                texturePath={path}
                displayName={displayName}
                packs={packs}
                folderSources={folderSources}
                textureOverrides={textureOverrides}
                folder={folder}
                onOverride={onOverride}
                onOpenLightbox={() => onOpenLightbox(path, displayName, folder)}
              />
              <span className="text-[10px] text-muted-foreground text-center truncate px-1">{folder}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Texture Lightbox ──────────────────────────────────────────────────────────

function TextureLightbox({
  texturePath,
  displayName,
  folder,
  packs,
  folderSources,
  textureOverrides,
  atlasRegionOverrides,
  onOverride,
  onAtlasRegionOverride,
  onClose,
}: {
  texturePath: string;
  displayName: string;
  folder: string;
  packs: Pack[];
  folderSources: FolderSources;
  textureOverrides: TextureOverrides;
  atlasRegionOverrides: Record<string, Record<string, string>>;
  onOverride: (path: string, packId: string | null) => void;
  onAtlasRegionOverride: (atlasPath: string, regionId: string, packId: string | null) => void;
  onClose: () => void;
}) {
  const packsWithFile = packs.filter((p) => p.files.has(texturePath));
  const overridePackId = textureOverrides[texturePath];
  const folderPackId = folderSources[folder];
  const effectivePackId = overridePackId ?? folderPackId;
  const atlasDef = getAtlasDefinition(texturePath);
  const regionOverrides = atlasRegionOverrides[texturePath] ?? {};

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <span className="font-semibold text-sm">{displayName}</span>
          <span className="text-xs text-muted-foreground">{texturePath}</span>
          {atlasDef && (
            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded font-medium">Atlas</span>
          )}
          <button
            className="ml-auto text-muted-foreground hover:text-foreground text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Image previews */}
          <div className={`flex gap-3 flex-wrap ${packsWithFile.length === 1 ? "justify-center" : ""}`}>
            {packsWithFile.map((pack) => {
              const buf = pack.files.get(texturePath)!;
              const url = arrayBufferToDataURL(buf, texturePath);
              const isSelected = effectivePackId === pack.id || (!effectivePackId && pack === packsWithFile[0]);
              return (
                <div key={pack.id} className="flex flex-col items-center gap-2">
                  <button
                    className={`checkered rounded-lg p-3 border-2 transition-all ${isSelected ? "border-primary" : "border-transparent hover:border-border"} ${packsWithFile.length > 1 ? "cursor-pointer" : "cursor-default"}`}
                    onClick={() => {
                      if (packsWithFile.length <= 1) return;
                      onOverride(texturePath, overridePackId === pack.id ? null : pack.id);
                    }}
                    title={pack.name}
                  >
                    <img
                      src={url}
                      alt={pack.name}
                      className="texture-preview"
                      style={{ width: 160, height: 160, objectFit: "contain", imageRendering: "pixelated" }}
                    />
                  </button>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: pack.color }} />
                    <span className="text-xs text-muted-foreground">{pack.name}</span>
                    {isSelected && <span className="text-xs text-primary font-bold">✓</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Atlas region editor */}
          {atlasDef && packsWithFile.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-secondary/50 border-b border-border">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {atlasDef.label} — Region Overrides
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pick a different pack for each region. On export, regions are composited onto the base atlas.
                </p>
              </div>
              <div className="divide-y divide-border">
                {atlasDef.regions.map((region) => {
                  const regionPackId = regionOverrides[region.id];
                  const regionOverridePack = packsWithFile.find(p => p.id === regionPackId);
                  return (
                    <div
                      key={region.id}
                      className="flex items-center gap-3 px-3 py-2.5 border-l-4 transition-colors"
                      style={{ borderLeftColor: regionOverridePack ? regionOverridePack.color : "transparent" }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{region.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {region.description} · ({region.x},{region.y}) {region.w}×{region.h}px
                        </div>
                      </div>
                      <div className="flex gap-1 flex-wrap justify-end">
                        <button
                          className={`text-xs px-2 py-0.5 rounded transition-colors ${!regionPackId ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:bg-accent"}`}
                          onClick={() => onAtlasRegionOverride(texturePath, region.id, null)}
                        >
                          auto
                        </button>
                        {packsWithFile.map((p) => (
                          <button
                            key={p.id}
                            className={`text-xs px-2 py-0.5 rounded transition-colors max-w-[80px] truncate ${regionPackId === p.id ? "font-semibold" : "text-muted-foreground hover:bg-accent"}`}
                            style={regionPackId === p.id ? { background: p.color + "33", color: p.color } : {}}
                            onClick={() => onAtlasRegionOverride(texturePath, region.id, regionPackId === p.id ? null : p.id)}
                            title={p.name}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Whole-file pack selector for non-atlas or as fallback */}
          {packsWithFile.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Whole file:</span>
              <button
                className={`text-xs px-2 py-0.5 rounded transition-colors ${!overridePackId ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:bg-accent"}`}
                onClick={() => onOverride(texturePath, null)}
              >
                auto
              </button>
              {packsWithFile.map((p) => (
                <button
                  key={p.id}
                  className={`text-xs px-2 py-0.5 rounded transition-colors max-w-[80px] truncate ${overridePackId === p.id ? "font-semibold" : "text-muted-foreground hover:bg-accent"}`}
                  style={overridePackId === p.id ? { background: p.color + "33", color: p.color } : {}}
                  onClick={() => onOverride(texturePath, overridePackId === p.id ? null : p.id)}
                  title={p.name}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Image Cropper ─────────────────────────────────────────────────────────────

const CROP_DISPLAY = 300;

function ImageCropper({
  src,
  onCrop,
  onCancel,
}: {
  src: string;
  onCrop: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState({ x: 25, y: 25, size: 250 });
  const [dragging, setDragging] = useState<"move" | "resize" | null>(null);
  const [origin, setOrigin] = useState({ mx: 0, my: 0, cx: 0, cy: 0, cs: 0 });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCancel]);

  const clampCrop = (c: { x: number; y: number; size: number }) => {
    const size = Math.max(20, Math.min(CROP_DISPLAY, c.size));
    const x = Math.max(0, Math.min(CROP_DISPLAY - size, c.x));
    const y = Math.max(0, Math.min(CROP_DISPLAY - size, c.y));
    return { x, y, size };
  };

  const startMove = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging("move");
    setOrigin({ mx: e.clientX, my: e.clientY, cx: crop.x, cy: crop.y, cs: crop.size });
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging("resize");
    setOrigin({ mx: e.clientX, my: e.clientY, cx: crop.x, cy: crop.y, cs: crop.size });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - origin.mx;
    const dy = e.clientY - origin.my;
    if (dragging === "move") {
      setCrop(clampCrop({ x: origin.cx + dx, y: origin.cy + dy, size: origin.cs }));
    } else {
      const delta = Math.max(dx, dy);
      setCrop(clampCrop({ x: origin.cx, y: origin.cy, size: origin.cs + delta }));
    }
  };

  const handleApply = () => {
    const img = imgRef.current;
    if (!img) return;
    const scaleX = img.naturalWidth / CROP_DISPLAY;
    const scaleY = img.naturalHeight / CROP_DISPLAY;
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, crop.x * scaleX, crop.y * scaleY, crop.size * scaleX, crop.size * scaleY, 0, 0, 128, 128);
    onCrop(canvas.toDataURL("image/png"));
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onMouseMove={onMouseMove}
      onMouseUp={() => setDragging(null)}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <span className="font-semibold text-sm">Crop Icon</span>
          <span className="text-xs text-muted-foreground">Drag box to move · corner handle to resize</span>
          <button onClick={onCancel} className="ml-auto text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>

        <div className="p-4">
          <div
            className="relative overflow-hidden rounded border border-border select-none"
            style={{ width: CROP_DISPLAY, height: CROP_DISPLAY, cursor: dragging === "move" ? "grabbing" : "default" }}
          >
            <img
              ref={imgRef}
              src={src}
              draggable={false}
              style={{ width: CROP_DISPLAY, height: CROP_DISPLAY, objectFit: "fill", display: "block", userSelect: "none" }}
            />
            {/* Crop box */}
            <div
              className="absolute border-2 border-white cursor-grab active:cursor-grabbing"
              style={{
                left: crop.x, top: crop.y, width: crop.size, height: crop.size,
                boxShadow: "0 0 0 2000px rgba(0,0,0,0.55)",
              }}
              onMouseDown={startMove}
            >
              {/* Corner markers */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-white pointer-events-none" />
              <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-white pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-white pointer-events-none" />
              {/* Resize handle (bottom-right) */}
              <div
                className="absolute bottom-0 right-0 w-5 h-5 bg-white cursor-se-resize flex items-center justify-center"
                style={{ borderRadius: "3px 0 0 0" }}
                onMouseDown={startResize}
              >
                <span className="text-[8px] text-black font-bold leading-none select-none">↘</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">Output will be cropped to a square (128 × 128 px)</p>
        </div>

        <div className="px-4 pb-4 flex items-center justify-end gap-2">
          <Btn variant="default" onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" onClick={handleApply}>Apply Crop</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Modal ─────────────────────────────────────────────────────────────

function SettingsModal({
  texturesPerRow,
  onTexturesPerRowChange,
  darkMode,
  onDarkModeChange,
  defaultPackName,
  defaultPackDescription,
  defaultPackIcon,
  onDefaultNameChange,
  onDefaultDescriptionChange,
  onDefaultIconChange,
  onDefaultIconRemove,
  onClose,
}: {
  texturesPerRow: number;
  onTexturesPerRowChange: (n: number) => void;
  darkMode: boolean;
  onDarkModeChange: (v: boolean) => void;
  defaultPackName: string;
  defaultPackDescription: string;
  defaultPackIcon: string | null;
  onDefaultNameChange: (v: string) => void;
  onDefaultDescriptionChange: (v: string) => void;
  onDefaultIconChange: (dataUrl: string) => void;
  onDefaultIconRemove: () => void;
  onClose: () => void;
}) {
  const iconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const handleIconFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => onDefaultIconChange(reader.result as string);
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  const clampCols = (n: number) => Math.max(1, Math.min(12, n));

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute top-14 left-4 w-76 bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 288 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-semibold text-sm">Settings</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>

        {/* Display */}
        <div className="px-4 py-3 flex flex-col gap-3 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Display</span>

          <div className="flex items-center gap-2">
            <span className="text-sm flex-1">Textures per row</span>
            <button
              onClick={() => onTexturesPerRowChange(clampCols(texturesPerRow - 1))}
              className="w-7 h-7 rounded bg-secondary hover:bg-accent border border-border text-sm font-bold flex items-center justify-center transition-colors"
            >−</button>
            <input
              type="number"
              value={texturesPerRow}
              onChange={(e) => onTexturesPerRowChange(clampCols(parseInt(e.target.value) || 6))}
              className="w-10 text-center bg-secondary border border-border rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              min={1} max={12}
            />
            <button
              onClick={() => onTexturesPerRowChange(clampCols(texturesPerRow + 1))}
              className="w-7 h-7 rounded bg-secondary hover:bg-accent border border-border text-sm font-bold flex items-center justify-center transition-colors"
            >+</button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm flex-1">{darkMode ? "Dark mode" : "Light mode"}</span>
            <button
              onClick={() => onDarkModeChange(!darkMode)}
              className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${darkMode ? "bg-primary" : "bg-secondary border border-border"}`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${darkMode ? "right-0.5" : "left-0.5"}`}
              />
            </button>
          </div>
        </div>

{/* Upload defaults */}
        <div className="px-4 py-3 flex flex-col gap-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Upload defaults</span>

          {/* Icon */}
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <button
                className="w-14 h-14 rounded border border-border overflow-hidden checkered hover:border-primary transition-colors cursor-pointer"
                onClick={() => iconInputRef.current?.click()}
                title="Click to set pack icon"
              >
                {defaultPackIcon ? (
                  <img src={defaultPackIcon} className="w-full h-full object-cover texture-preview" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">📦</div>
                )}
              </button>
              {defaultPackIcon && (
                <button
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center hover:opacity-90"
                  onClick={onDefaultIconRemove}
                  title="Remove icon"
                >✕</button>
              )}
            </div>
            <input ref={iconInputRef} type="file" accept="image/*" className="hidden" onChange={handleIconFile} />
            <div className="flex-1 text-xs text-muted-foreground">
              {defaultPackIcon ? "Click icon to replace" : "Click icon to upload"}
              <br />These values are used as defaults for new uploads.
            </div>
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Default pack name</label>
            <input
              type="text"
              value={defaultPackName}
              onChange={(e) => onDefaultNameChange(e.target.value)}
              className="bg-secondary border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono"
              placeholder="My Resource Pack"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Default description (pack.mcmeta)</label>
            <input
              type="text"
              value={defaultPackDescription}
              onChange={(e) => onDefaultDescriptionChange(e.target.value)}
              className="bg-secondary border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono"
              placeholder="A Minecraft resource pack"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [selectedFolder, setSelectedFolder] = useState("blocks");
  const [folderSources, setFolderSources] = useState<FolderSources>({});
  const [textureOverrides, setTextureOverrides] = useState<TextureOverrides>({});
  const [atlasRegionOverrides, setAtlasRegionOverrides] = useState<Record<string, Record<string, string>>>({});
  const [uploadDefaults, setUploadDefaults] = useState<UploadDefaults>(() => readUploadDefaults());
  const [packName, setPackName] = useState(uploadDefaults.name);
  const [packDescription, setPackDescription] = useState(uploadDefaults.description);
  const [packIcon, setPackIcon] = useState<string | null>(uploadDefaults.icon);
  const [exporting, setExporting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [globalSearch, setGlobalSearch] = useState("");
  const [lightbox, setLightbox] = useState<{ path: string; displayName: string; folder: string } | null>(null);
  // Settings
  const [texturesPerRow, setTexturesPerRow] = useState(6);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem("mc-pack-editor-theme");
    return saved ? saved === "dark" : true;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Pack visibility: missing key = visible
  const [packVisibility, setPackVisibility] = useState<Record<string, boolean>>({});
  // Icon cropping
  const [cropSource, setCropSource] = useState<string | null>(null);

  const handlePacksLoaded = useCallback((newPacks: Pack[]) => {
    setPacks((prev) => {
      const existing = new Set(prev.map((p) => p.name));
      const deduped = newPacks.filter((p) => !existing.has(p.name));
      // Newest uploads go to the front (highest priority), like in-game behavior
      return [...deduped, ...prev];
    });

    setPackName(uploadDefaults.name);
    setPackDescription(uploadDefaults.description);
    setPackIcon(uploadDefaults.icon);
  }, [uploadDefaults]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
    window.localStorage.setItem("mc-pack-editor-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    window.localStorage.setItem("mc-pack-editor-upload-defaults", JSON.stringify(uploadDefaults));
  }, [uploadDefaults]);

  useEffect(() => {
    setPackName(uploadDefaults.name);
    setPackDescription(uploadDefaults.description);
    setPackIcon(uploadDefaults.icon);
  }, [uploadDefaults]);

  const removePack = useCallback((id: string) => {
    setPacks((prev) => prev.filter((p) => p.id !== id));
    setFolderSources((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => { if (next[k] === id) delete next[k]; });
      return next;
    });
    setTextureOverrides((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => { if (next[k] === id) delete next[k]; });
      return next;
    });
    setAtlasRegionOverrides((prev) => {
      const next: typeof prev = {};
      for (const [path, regions] of Object.entries(prev)) {
        const filtered: Record<string, string> = {};
        for (const [regionId, packId] of Object.entries(regions)) {
          if (packId !== id) filtered[regionId] = packId;
        }
        if (Object.keys(filtered).length > 0) next[path] = filtered;
      }
      return next;
    });
  }, []);

  const handleAtlasRegionOverride = useCallback((atlasPath: string, regionId: string, packId: string | null) => {
    setAtlasRegionOverrides((prev) => {
      const next = { ...prev, [atlasPath]: { ...prev[atlasPath] } };
      if (packId === null) delete next[atlasPath][regionId];
      else next[atlasPath][regionId] = packId;
      if (Object.keys(next[atlasPath]).length === 0) delete next[atlasPath];
      return next;
    });
  }, []);

  const handleFolderSource = useCallback((folder: string, packId: string | null) => {
    setFolderSources((prev) => {
      const next = { ...prev };
      if (packId === null) delete next[folder];
      else next[folder] = packId;
      return next;
    });
  }, []);

  const handleOverride = useCallback((path: string, packId: string | null) => {
    setTextureOverrides((prev) => {
      const next = { ...prev };
      if (packId === null) delete next[path];
      else next[path] = packId;
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    if (!packs.length) return;
    setExporting(true);
    try {
      const blob = await exportMergedPack(
        packs,
        folderSources,
        textureOverrides,
        atlasRegionOverrides,
        packName,
        packDescription,
        packIcon
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // § is valid Unicode and Minecraft renders it as color — only strip truly illegal filename chars
      const safeFilename = packName
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "")  // illegal on Windows/macOS/Linux
        .trim()
        || "resource_pack";
      a.download = `${safeFilename}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setExporting(false);
    }
  }, [packs, folderSources, textureOverrides, atlasRegionOverrides, packName, packDescription, packIcon]);

  const reorderPacks = useCallback((newOrder: Pack[]) => {
    setPacks(newOrder);
  }, []);

  const handleColorChange = useCallback((id: string, color: string) => {
    setPacks((prev) => prev.map((p) => (p.id === id ? { ...p, color } : p)));
  }, []);

  const handleVisibilityToggle = useCallback((id: string) => {
    setPackVisibility((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));
  }, []);

  const visiblePacks = useMemo(
    () => packs.filter((p) => packVisibility[p.id] !== false),
    [packs, packVisibility]
  );

  const overrideCount = Object.keys(textureOverrides).length;
  const folderSourceCount = Object.values(folderSources).filter(Boolean).length;

  return (
    <div className={`flex flex-col h-screen bg-background text-foreground overflow-hidden${darkMode ? " dark" : ""}`}>
      {/* ── Header ── */}
      <header className="flex-shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Settings gear */}
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className={`w-7 h-7 rounded flex items-center justify-center text-base transition-colors ${settingsOpen ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
              title="Settings"
            >
              ⚙
            </button>
            <h1 className="text-base font-bold text-foreground">MC Resource Pack Editor</h1>
            <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">1.8</span>
          </div>

          <div className="flex-1 min-w-0 flex items-center gap-3">
            {packs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Upload resource pack ZIPs to get started</p>
            ) : (
              <>
                <PackOrderPanel
                  packs={packs}
                  onReorder={reorderPacks}
                  onRemove={removePack}
                  packVisibility={packVisibility}
                  onVisibilityToggle={handleVisibilityToggle}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  {packs.map((p) => (
                    <Badge key={p.id} color={p.color} label={p.name} />
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {packs.length > 0 && (
              <Btn
                variant="primary"
                onClick={handleExport}
                disabled={exporting}
                className="font-semibold"
              >
                {exporting ? "Exporting…" : "⬇️ Export ZIP"}
              </Btn>
            )}
          </div>
        </div>
      </header>

      {/* ── Sub-header: pack settings + upload ── */}
      <div className="flex-shrink-0 border-b border-border bg-card/50 px-4 py-2">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[280px]">
            <PackSettings
              packName={packName}
              packDescription={packDescription}
              packIcon={packIcon}
              onNameChange={setPackName}
              onDescriptionChange={setPackDescription}
              onIconChange={(d) => { if (d === null) setPackIcon(null); else setCropSource(d); }}
            />
          </div>
          <div className="flex-shrink-0 w-64">
            <DropZone onLoad={handlePacksLoaded} />
          </div>
          {(overrideCount > 0 || folderSourceCount > 0) && (
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {folderSourceCount > 0 && <span>📁 {folderSourceCount} folder source{folderSourceCount !== 1 ? "s" : ""} set</span>}
              {overrideCount > 0 && <span>🎯 {overrideCount} texture override{overrideCount !== 1 ? "s" : ""}</span>}
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      {packs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-8">
            <h2 className="text-xl font-bold mb-2">Minecraft 1.8 Resource Pack Editor</h2>
            <p className="text-muted-foreground text-sm">
              Upload one or more resource pack ZIP files above to compare textures, set default sources per folder, override individual textures, and export a merged pack.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <aside
            className={`flex-shrink-0 border-r border-border bg-sidebar overflow-y-auto transition-all duration-200 ${sidebarOpen ? "w-56" : "w-0 overflow-hidden border-r-0"}`}
          >
            <div className="px-3 py-2 border-b border-sidebar-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Folders</span>
            </div>
            <FolderSidebar
              packs={packs}
              selectedFolder={selectedFolder}
              onSelect={setSelectedFolder}
              folderSources={folderSources}
              onFolderSource={handleFolderSource}
            />
          </aside>

          {/* Toggle sidebar */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="flex-shrink-0 w-5 flex items-center justify-center bg-sidebar border-r border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <span className="text-xs">{sidebarOpen ? "‹" : "›"}</span>
          </button>

          {/* Main content */}
          <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Folder header + global search */}
            <div className="flex-shrink-0 px-4 py-2 border-b border-border flex items-center gap-3">
              {globalSearch ? (
                <span className="font-semibold">Search results</span>
              ) : (
                <span className="font-semibold">
                  {MC_FOLDERS.find((f) => f.key === selectedFolder)?.label ?? selectedFolder}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <input
                  type="search"
                  placeholder="Search all textures…"
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  className="bg-secondary border border-border rounded px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-48"
                />
                {!globalSearch && packs.length > 1 && (
                  <span className="text-xs text-muted-foreground hidden xl:block">
                    Click preview to pick pack • Click name for folder default
                  </span>
                )}
              </div>
            </div>

            {/* Texture grid or search results */}
            <div className="flex-1 overflow-y-auto p-4">
              {globalSearch ? (
                <SearchAllResults
                  query={globalSearch}
                  packs={visiblePacks}
                  folderSources={folderSources}
                  textureOverrides={textureOverrides}
                  onOverride={handleOverride}
                  onOpenLightbox={(path, displayName, folder) => setLightbox({ path, displayName, folder })}
                  cols={texturesPerRow}
                />
              ) : (
                <TextureGrid
                  packs={visiblePacks}
                  folder={selectedFolder}
                  folderSources={folderSources}
                  textureOverrides={textureOverrides}
                  onOverride={handleOverride}
                  onOpenLightbox={(path, displayName, folder) => setLightbox({ path, displayName, folder })}
                  cols={texturesPerRow}
                />
              )}
            </div>
          </main>
        </div>
      )}

      {/* ── Lightbox modal ── */}
      {lightbox && (
        <TextureLightbox
          texturePath={lightbox.path}
          displayName={lightbox.displayName}
          folder={lightbox.folder}
          packs={visiblePacks}
          folderSources={folderSources}
          textureOverrides={textureOverrides}
          atlasRegionOverrides={atlasRegionOverrides}
          onOverride={handleOverride}
          onAtlasRegionOverride={handleAtlasRegionOverride}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* ── Settings modal ── */}
      {settingsOpen && (
        <SettingsModal
          texturesPerRow={texturesPerRow}
          onTexturesPerRowChange={setTexturesPerRow}
          darkMode={darkMode}
          onDarkModeChange={setDarkMode}
          defaultPackName={uploadDefaults.name}
          defaultPackDescription={uploadDefaults.description}
          defaultPackIcon={uploadDefaults.icon}
          onDefaultNameChange={(value) => setUploadDefaults((prev) => ({ ...prev, name: value }))}
          onDefaultDescriptionChange={(value) => setUploadDefaults((prev) => ({ ...prev, description: value }))}
          onDefaultIconChange={(dataUrl) => setUploadDefaults((prev) => ({ ...prev, icon: dataUrl }))}
          onDefaultIconRemove={() => setUploadDefaults((prev) => ({ ...prev, icon: null }))}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* ── Icon cropper ── */}
      {cropSource && (
        <ImageCropper
          src={cropSource}
          onCrop={(dataUrl) => { setPackIcon(dataUrl); setCropSource(null); }}
          onCancel={() => setCropSource(null)}
        />
      )}
    </div>
  );
}
