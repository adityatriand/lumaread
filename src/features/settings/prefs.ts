export const THEMES = {
  light: { background: "#ffffff", color: "#1f1f2e" },
  dark: { background: "#16161d", color: "#e6e6ee" },
  sepia: { background: "#f6efdf", color: "#433422" },
};
export const LINE_HEIGHTS = { compact: 1.4, normal: 1.65, relaxed: 1.9 };

export type Theme = keyof typeof THEMES;
export type LineSpacing = keyof typeof LINE_HEIGHTS;
export type AppTheme = "light" | "dark" | "system";
// continuous = vertical scroll; spread = two pages side by side (desktop); horizontal = swipe left–right (mobile)
export type Layout = "continuous" | "spread" | "horizontal";

export interface ReadingPrefs { fontSize: number; lineSpacing: LineSpacing; theme: Theme; appTheme: AppTheme; layout: Layout }

const DEFAULTS: ReadingPrefs = { fontSize: 100, lineSpacing: "normal", theme: "light", appTheme: "light", layout: "continuous" };

// Device kind, not window width: a narrow desktop window still gets desktop layouts
export const isPhone = () => /Android|iPhone|iPad/i.test(navigator.userAgent) || matchMedia("(pointer: coarse)").matches;

// Each device offers its own pair of layouts; a value saved on the other kind of device falls back to scrolling
export const LAYOUTS: { value: Layout; label: string }[] = isPhone()
  ? [{ value: "continuous", label: "Scroll up–down" }, { value: "horizontal", label: "Swipe left–right" }]
  : [{ value: "continuous", label: "Continuous scroll" }, { value: "spread", label: "Side by side" }];

export const effectiveLayout = (l: Layout): Layout => (LAYOUTS.some((o) => o.value === l) ? l : "continuous");

export const applyAppTheme = (t: AppTheme) => (document.documentElement.dataset.theme = t);

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
