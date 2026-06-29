export type GrainBlendMode = "screen" | "overlay" | "soft-light" | "normal";

export type SofteningChannel = "background" | "font" | "borders" | "icons";

export interface SofteningSettings {
  background: number;
  font: number;
  borders: number;
  icons: number;
}

export interface SvgNormalSettings {
  enabled: boolean;
  opacity: number;
  frequency: number;
  depth: number;
  azimuth: number;
  elevation: number;
}

export interface CssBevelSettings {
  enabled: boolean;
  strength: number;
  depth: number;
  highlight: number;
  shadow: number;
  text: number;
}

export interface GrainSettings {
  enabled: boolean;
  opacity: number;
  frequency: number;
  contrast: number;
  blendMode: GrainBlendMode;
  softening: SofteningSettings;
  svgNormal: SvgNormalSettings;
  cssBevel: CssBevelSettings;
}

export type GrainSettingsPatch = Omit<Partial<GrainSettings>, "softening" | "svgNormal" | "cssBevel"> & {
  softening?: Partial<SofteningSettings>;
  svgNormal?: Partial<SvgNormalSettings>;
  cssBevel?: Partial<CssBevelSettings>;
};

export const DEFAULT_SOFTENING_SETTINGS: SofteningSettings = {
  background: 1,
  font: 0.8,
  borders: 0.8,
  icons: 0.8,
};

export const DEFAULT_SVG_NORMAL_SETTINGS: SvgNormalSettings = {
  enabled: false,
  opacity: 0.08,
  frequency: 0.72,
  depth: 1.6,
  azimuth: 135,
  elevation: 44,
};

export const DEFAULT_CSS_BEVEL_SETTINGS: CssBevelSettings = {
  enabled: false,
  strength: 0.45,
  depth: 1.2,
  highlight: 0.55,
  shadow: 0.55,
  text: 0.25,
};

export const DEFAULT_GRAIN_SETTINGS: GrainSettings = {
  enabled: true,
  opacity: 0.1,
  frequency: 0.8,
  contrast: 1.3,
  blendMode: "screen",
  softening: DEFAULT_SOFTENING_SETTINGS,
  svgNormal: DEFAULT_SVG_NORMAL_SETTINGS,
  cssBevel: DEFAULT_CSS_BEVEL_SETTINGS,
};

export const GRAIN_BLEND_OPTIONS: ReadonlyArray<{ id: GrainBlendMode; label: string }> = [
  { id: "screen", label: "Screen" },
  { id: "overlay", label: "Overlay" },
  { id: "soft-light", label: "Soft Light" },
  { id: "normal", label: "Normal" },
];

export const SOFTENING_CHANNEL_OPTIONS: ReadonlyArray<{ id: SofteningChannel; label: string }> = [
  { id: "background", label: "Background" },
  { id: "font", label: "Font" },
  { id: "borders", label: "Borders" },
  { id: "icons", label: "Icons" },
];

const STYLE_SETTINGS_KEY = "styleSettings.v1";

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function isGrainBlendMode(value: unknown): value is GrainBlendMode {
  return GRAIN_BLEND_OPTIONS.some((option) => option.id === value);
}

function normalizeSofteningSettings(input: unknown): SofteningSettings {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    background: clampNumber(source.background, 0, 1, DEFAULT_SOFTENING_SETTINGS.background),
    font: clampNumber(source.font, 0, 1, DEFAULT_SOFTENING_SETTINGS.font),
    borders: clampNumber(source.borders, 0, 1, DEFAULT_SOFTENING_SETTINGS.borders),
    icons: clampNumber(source.icons, 0, 1, DEFAULT_SOFTENING_SETTINGS.icons),
  };
}

function normalizeSvgNormalSettings(input: unknown): SvgNormalSettings {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SVG_NORMAL_SETTINGS.enabled,
    opacity: clampNumber(source.opacity, 0, 0.2, DEFAULT_SVG_NORMAL_SETTINGS.opacity),
    frequency: clampNumber(source.frequency, 0.12, 1.8, DEFAULT_SVG_NORMAL_SETTINGS.frequency),
    depth: clampNumber(source.depth, 0, 8, DEFAULT_SVG_NORMAL_SETTINGS.depth),
    azimuth: clampNumber(source.azimuth, 0, 360, DEFAULT_SVG_NORMAL_SETTINGS.azimuth),
    elevation: clampNumber(source.elevation, 5, 90, DEFAULT_SVG_NORMAL_SETTINGS.elevation),
  };
}

function normalizeCssBevelSettings(input: unknown): CssBevelSettings {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CSS_BEVEL_SETTINGS.enabled,
    strength: clampNumber(source.strength, 0, 1, DEFAULT_CSS_BEVEL_SETTINGS.strength),
    depth: clampNumber(source.depth, 0, 4, DEFAULT_CSS_BEVEL_SETTINGS.depth),
    highlight: clampNumber(source.highlight, 0, 1, DEFAULT_CSS_BEVEL_SETTINGS.highlight),
    shadow: clampNumber(source.shadow, 0, 1, DEFAULT_CSS_BEVEL_SETTINGS.shadow),
    text: clampNumber(source.text, 0, 1, DEFAULT_CSS_BEVEL_SETTINGS.text),
  };
}

export function normalizeGrainSettings(input: GrainSettingsPatch | Record<string, unknown>): GrainSettings {
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_GRAIN_SETTINGS.enabled,
    opacity: clampNumber(input.opacity, 0, 0.24, DEFAULT_GRAIN_SETTINGS.opacity),
    frequency: clampNumber(input.frequency, 0.25, 1.6, DEFAULT_GRAIN_SETTINGS.frequency),
    contrast: clampNumber(input.contrast, 0.55, 2.2, DEFAULT_GRAIN_SETTINGS.contrast),
    blendMode: isGrainBlendMode(input.blendMode) ? input.blendMode : DEFAULT_GRAIN_SETTINGS.blendMode,
    softening: normalizeSofteningSettings(input.softening),
    svgNormal: normalizeSvgNormalSettings(input.svgNormal),
    cssBevel: normalizeCssBevelSettings(input.cssBevel),
  };
}

export function loadGrainSettings(): GrainSettings {
  try {
    const raw = localStorage.getItem(STYLE_SETTINGS_KEY);
    if (!raw) return DEFAULT_GRAIN_SETTINGS;
    return normalizeGrainSettings(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return DEFAULT_GRAIN_SETTINGS;
  }
}

export function saveGrainSettings(settings: GrainSettings) {
  try {
    localStorage.setItem(STYLE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // The live settings still apply if storage is unavailable.
  }
}
