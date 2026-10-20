import { invoke } from "@tauri-apps/api/core";
import { Copy, Download, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { saveBinaryFile } from "../../lib/saveFile";
import { CARD_THEMES, toPngBlob, type CardFormat, type CardTheme } from "./quoteCard";

interface Props {
  heading: string;
  alt: string; // describes the image for screen readers
  caption: string; // sent as text alongside the image where the target app accepts it
  fileBase: string;
  render: (format: CardFormat, theme: CardTheme) => Promise<HTMLCanvasElement>;
  onClose: () => void;
}

// The native share sheet (Instagram Stories, WhatsApp Status, …) is Android-only; desktop saves or copies
const isAndroid = /Android/i.test(navigator.userAgent);

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function ShareImageDialog({ heading, alt, caption, fileBase, render, onClose }: Props) {
  const [format, setFormat] = useState<CardFormat>("story");
  const [theme, setTheme] = useState<CardTheme>("luma");
  const [card, setCard] = useState<{ url: string; blob: Blob }>();
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    render(format, theme)
      .then(toPngBlob)
      .then((blob) => current && setCard({ url: URL.createObjectURL(blob), blob }))
      .catch(() => current && setStatus("Could not create the image."));
    return () => {
      current = false;
    };
    // render is recreated by callers each render; the card only depends on format and theme here
  }, [format, theme]);

  // Free each preview's object URL once it is replaced or the dialog closes
  useEffect(() => () => card && URL.revokeObjectURL(card.url), [card]);

  const fileName = `${fileBase}-${format}.png`;

  async function run(action: () => Promise<string | undefined>) {
    setBusy(true);
    try {
      setStatus(await action());
    } catch {
      setStatus("That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const share = () =>
    run(async () => {
      await invoke("plugin:quoteshare|share_image", { payload: { base64: await base64(card!.blob), fileName, text: caption, title: heading } });
      return undefined;
    });
  const saveImage = () =>
    run(async () => ((await saveBinaryFile(fileName, new Uint8Array(await card!.blob.arrayBuffer()))) ? "Image saved." : undefined));
  const copyImage = () =>
    run(async () => {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": card!.blob })]);
      return "Image copied. Paste it into any app.";
    });

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog share-dialog" role="dialog" aria-modal="true" aria-label={heading} onClick={(e) => e.stopPropagation()}>
        <header className="lookup-header">
          <h2>{heading}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </header>

        <div className={`card-preview ${format}`}>
          {card ? <img src={card.url} alt={alt} /> : <span className="muted">Creating image…</span>}
        </div>

        <div className="share-options">
          <div className="segmented" role="radiogroup" aria-label="Format">
            {(["story", "square"] as const).map((f) => (
              <button key={f} role="radio" aria-checked={format === f} aria-pressed={format === f} onClick={() => setFormat(f)}>
                {f === "story" ? "Story 9:16" : "Square"}
              </button>
            ))}
          </div>
          <div className="color-row" role="radiogroup" aria-label="Style">
            {(Object.keys(CARD_THEMES) as CardTheme[]).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                aria-label={CARD_THEMES[t].label}
                className="swatch-button"
                style={{ background: `linear-gradient(135deg, ${CARD_THEMES[t].bg[0]}, ${CARD_THEMES[t].bg[1]})` }}
                onClick={() => setTheme(t)}
              />
            ))}
          </div>
        </div>

        <div className="share-actions">
          {isAndroid && (
            <button className="button primary" disabled={!card || busy} onClick={share}><Share2 size={16} /> Share to Stories, WhatsApp…</button>
          )}
          <button className="button" disabled={!card || busy} onClick={saveImage}><Download size={16} /> Save image</button>
          {!isAndroid && <button className="button" disabled={!card || busy} onClick={copyImage}><Copy size={16} /> Copy image</button>}
        </div>
        {status && <p className="muted small" role="status">{status}</p>}
      </div>
    </div>
  );
}
