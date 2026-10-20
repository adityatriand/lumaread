import { AlignJustify, AlignLeft, Menu } from "lucide-react";
import { LINE_HEIGHTS, THEMES, type LineSpacing, type ReadingPrefs, type Theme } from "./prefs";

interface Props { prefs: ReadingPrefs; onChange: (p: ReadingPrefs) => void }

const SPACING_ICONS = { compact: AlignJustify, normal: Menu, relaxed: AlignLeft };
const label = (s: string) => s[0].toUpperCase() + s.slice(1);

export function ReadingPrefsForm({ prefs, onChange }: Props) {
  const set = (next: Partial<ReadingPrefs>) => onChange({ ...prefs, ...next });

  return (
    <div className="prefs">
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

      <fieldset>
        <legend>Theme</legend>
        <div className="theme-options">
          {(Object.keys(THEMES) as Theme[]).map((t) => (
            <label key={t} className="theme-option">
              <input type="radio" name="theme" checked={prefs.theme === t} onChange={() => set({ theme: t })} />
              <span className="swatch" style={{ background: THEMES[t].background }} />
              {label(t)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
