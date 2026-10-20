import { BookOpen, Info, Languages, Palette, ScanText, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { formatSize } from "../../lib/format";
import { AppThemePicker, ReadingPrefsForm } from "./ReadingPrefsForm";
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

const SECTIONS = [
  { id: "reading", label: "Reading", Icon: BookOpen },
  { id: "appearance", label: "Appearance", Icon: Palette },
  { id: "translation", label: "Translation", Icon: Languages },
  { id: "files", label: "OCR & Files", Icon: ScanText },
  { id: "privacy", label: "Privacy", Icon: Shield },
  { id: "about", label: "About", Icon: Info },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

export function SettingsPage({ prefs, onChange }: Props) {
  const [section, setSection] = useState<Section>("reading");
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="screen">
      <header className="page-header">
        <h1>Settings</h1>
      </header>
      <div className="card settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, Icon }) => (
            <button key={id} className="nav-item" aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
              <Icon size={16} aria-hidden="true" /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <section className="settings-body" aria-label={current.label}>
          {section === "reading" && (
            <>
              <h2>Reading preferences</h2>
              <ReadingPrefsForm prefs={prefs} onChange={onChange} />
            </>
          )}
          {section === "appearance" && (
            <>
              <h2>Appearance</h2>
              <AppThemePicker prefs={prefs} onChange={onChange} />
            </>
          )}
          {section === "translation" && (
            <>
              <h2>Translation &amp; dictionary</h2>
              <p className="muted">
                Select text while reading and tap Translate. Indonesian ⇄ English translation and the English and Indonesian
                dictionaries run on this device, so lookups work offline and nothing you select is sent anywhere.
              </p>
            </>
          )}
          {section === "files" && <FilesSection />}
          {section === "privacy" && (
            <>
              <h2>Privacy</h2>
              <p className="muted">
                Your files, highlights, reading progress and settings are stored only on this device. Text recognition, dictionary
                and translation also run on this device — nothing is uploaded. Uninstalling the app removes your library, so export
                your highlights and notes to keep a copy.
              </p>
            </>
          )}
          {section === "about" && (
            <>
              <h2>About &amp; licences</h2>
              <dl className="credits">
                {CREDITS.map(([what, who, licence]) => (
                  <div key={what}>
                    <dt>{what}</dt>
                    <dd>{who} · <span className="muted">{licence}</span></dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function FilesSection() {
  const [usage, setUsage] = useState<string>();
  useEffect(() => {
    navigator.storage?.estimate?.().then(({ usage: used = 0 }) => setUsage(formatSize(used)), () => undefined);
  }, []);
  return (
    <>
      <h2>OCR &amp; files</h2>
      <p className="muted">
        Scanned PDFs are recognised automatically, Indonesian and English, as you read — use “Recognize all pages” in the reader
        to make a whole book searchable. Supported files: EPUB and PDF up to 200 MB.
      </p>
      {usage && <p>Library storage on this device: <strong>{usage}</strong></p>}
    </>
  );
}
