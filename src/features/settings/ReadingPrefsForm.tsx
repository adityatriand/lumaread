import { AlignJustify, AlignLeft, BookOpen, Columns2, Menu, MoveHorizontal, MoveVertical } from "lucide-react";
import { LAYOUTS, LINE_HEIGHTS, THEMES, effectiveLayout, type AppTheme, type Layout, type LineSpacing, type ReadingPrefs, type Theme } from "./prefs";

interface Props {
  prefs: ReadingPrefs;
  onChange: (p: ReadingPrefs) => void;
  format?: "pdf" | "epub"; // PDFs keep their own typography, so font and spacing only show for EPUB
}

const SPACING_ICONS = { compact: AlignJustify, normal: Menu, relaxed: AlignLeft };
const LAYOUT_ICONS: Record<Layout, typeof BookOpen> = { continuous: MoveVertical, spread: Columns2, horizontal: MoveHorizontal };
const label = (s: string) => s[0].toUpperCase() + s.slice(1);

export function ReadingPrefsForm({ prefs, onChange, format }: Props) {
  const set = (next: Partial<ReadingPrefs>) => onChange({ ...prefs, ...next });
  const layout = effectiveLayout(prefs.layout);

  return (
    <div className="prefs">
      <fieldset>
        <legend>Page layout</legend>
        <div className="segmented wide" role="radiogroup" aria-label="Page layout">
          {LAYOUTS.map(({ value, label: text }) => {
            const Icon = LAYOUT_ICONS[value];
            return (
              <button key={value} role="radio" aria-checked={layout === value} aria-pressed={layout === value} onClick={() => set({ layout: value })}>
                <Icon size={16} aria-hidden="true" /> {text}
              </button>
            );
          })}
        </div>
      </fieldset>

      {format !== "pdf" && (
        <>
          <fieldset>
            <legend>Font size</legend>
            <div className="segmented">
              <button onClick={() => set({ fontSize: Math.max(70, prefs.fontSize - 10) })} aria-label="Smaller text">A−</button>
              <span aria-live="polite">{prefs.fontSize}%</span>
              <button onClick={() => set({ fontSize: Math.min(200, prefs.fontSize + 10) })} aria-label="Larger text">A+</button>
            </div>
          </fieldset>

          <fieldset>
            <legend>Line spacing</legend>
            <div className="segmented">
              {(Object.keys(LINE_HEIGHTS) as LineSpacing[]).map((s) => {
                const Icon = SPACING_ICONS[s];
                return (
                  <button key={s} aria-label={label(s)} aria-pressed={prefs.lineSpacing === s} onClick={() => set({ lineSpacing: s })}>
                    <Icon size={18} />
                  </button>
                );
              })}
            </div>
          </fieldset>
        </>
      )}

      <fieldset>
        <legend>Page color</legend>
        <div className="theme-options">
          {(Object.keys(THEMES) as Theme[]).map((t) => (
            <label key={t} className="theme-option">
              <input type="radio" name="page-theme" checked={prefs.theme === t} onChange={() => set({ theme: t })} />
              <span className="swatch" style={{ background: THEMES[t].background }} />
              {label(t)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

const APP_THEMES: { value: AppTheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

export function AppThemePicker({ prefs, onChange }: Pick<Props, "prefs" | "onChange">) {
  return (
    <fieldset className="prefs">
      <legend>App theme</legend>
      <div className="theme-options">
        {APP_THEMES.map((t) => (
          <label key={t.value} className="theme-option">
            <input type="radio" name="app-theme" checked={prefs.appTheme === t.value} onChange={() => onChange({ ...prefs, appTheme: t.value })} />
            <span className={`swatch app-${t.value}`} />
            {t.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
