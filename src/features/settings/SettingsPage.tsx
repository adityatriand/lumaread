import { ReadingPrefsForm } from "./ReadingPrefsForm";
import type { ReadingPrefs } from "./prefs";

interface Props { prefs: ReadingPrefs; onChange: (p: ReadingPrefs) => void }

// Shown in-app because CC BY / CC BY-SA require visible attribution and MPL/Apache ask for notices
const CREDITS: [string, string, string][] = [
  ["PDF rendering", "PDF.js — Mozilla", "Apache-2.0"],
  ["EPUB rendering", "epub.js — FuturePress", "BSD-2-Clause"],
  ["Text recognition (OCR)", "Tesseract & tesseract.js, Indonesian and English language data", "Apache-2.0"],
  ["Offline translation", "Bergamot translator & Firefox Translations models — Mozilla", "MPL-2.0"],
  ["English dictionary", "Open English WordNet 2025 — Open English WordNet contributors", "CC BY 4.0"],
  ["Indonesian dictionary", "Wiktionary contributors, extracted by kaikki.org; adapted (first three senses)", "CC BY-SA 4.0"],
  ["Reading typeface", "Source Serif 4 — Adobe", "SIL OFL 1.1"],
  ["Icons", "Lucide", "ISC"],
];

export function SettingsPage({ prefs, onChange }: Props) {
  return (
    <div className="screen">
      <header className="page-header">
        <h1>Settings</h1>
      </header>
      <section className="card">
        <h2>Reading preferences</h2>
        <p className="muted">Applies to EPUB books. PDFs keep their original layout.</p>
        <ReadingPrefsForm prefs={prefs} onChange={onChange} />
      </section>
      <section className="card">
        <h2>Privacy</h2>
        <p className="muted">
          Your files, highlights, reading progress and settings are stored only on this device. Text recognition, dictionary
          and translation also run on this device — nothing is uploaded. Uninstalling the app removes your library, so export
          your highlights and notes to keep a copy.
        </p>
      </section>
      <section className="card">
        <h2>About &amp; licences</h2>
        <dl className="credits">
          {CREDITS.map(([what, who, licence]) => (
            <div key={what}>
              <dt>{what}</dt>
              <dd>{who} · <span className="muted">{licence}</span></dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
