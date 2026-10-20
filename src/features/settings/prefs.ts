export const THEMES = {
  light: { background: "#ffffff", color: "#1f1f2e" },
  dark: { background: "#16161d", color: "#e6e6ee" },
  sepia: { background: "#f6efdf", color: "#433422" },
};
export const LINE_HEIGHTS = { compact: 1.4, normal: 1.65, relaxed: 1.9 };

export type Theme = keyof typeof THEMES;
export type LineSpacing = keyof typeof LINE_HEIGHTS;
export interface ReadingPrefs { fontSize: number; lineSpacing: LineSpacing; theme: Theme }

const DEFAULTS: ReadingPrefs = { fontSize: 100, lineSpacing: "normal", theme: "light" };
const KEY = "reading-prefs";

export function loadPrefs(): ReadingPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function storePrefs(p: ReadingPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Prefs just won't persist
  }
}
