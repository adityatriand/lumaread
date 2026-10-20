import { Upload } from "lucide-react";
import { useState } from "react";
import { importFile } from "./importFile";

interface Props { onImported: () => void }

export function ImportButton({ onImported }: Props) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    const failed: string[] = [];
    for (const file of files) {
      try {
        await importFile(file);
      } catch (e) {
        failed.push(e instanceof Error ? e.message : String(e));
      }
    }
    setErrors(failed);
    setBusy(false);
    onImported();
  }

  return (
    <>
      <label className={`button primary import${busy ? " disabled" : ""}`}>
        <Upload size={16} aria-hidden="true" />
        <span className="import-label">{busy ? "Importing…" : "Import"}</span>
        <input
          type="file"
          accept=".epub,.pdf,application/epub+zip,application/pdf"
          multiple
          hidden
          disabled={busy}
          onChange={(e) => {
            handleFiles(Array.from(e.currentTarget.files ?? []));
            e.currentTarget.value = "";
          }}
        />
      </label>
      {errors.length > 0 && (
        <div className="toast" role="alert">
          {errors.map((msg) => <p key={msg}>{msg}</p>)}
          <button onClick={() => setErrors([])}>Dismiss</button>
        </div>
      )}
    </>
  );
}
