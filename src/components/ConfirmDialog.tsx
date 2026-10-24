import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

interface Request { title: string; message: string; action: string; resolve: (ok: boolean) => void }

let show: ((r: Request) => void) | undefined;

// Every action that deletes or loses data asks here first. Resolves true only when the reader confirms;
// Cancel, Escape or a click outside resolve false.
export function confirmDanger(title: string, message: string, action = "Delete"): Promise<boolean> {
  return new Promise((resolve) => (show ? show({ title, message, action, resolve }) : resolve(false)));
}

// Mounted once by the app
export function ConfirmHost() {
  const [request, setRequest] = useState<Request>();

  useEffect(() => {
    show = (r) => setRequest((current) => (current?.resolve(false), r));
    return () => void (show = undefined);
  }, []);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request]);

  if (!request) return null;
  function close(ok: boolean) {
    request!.resolve(ok);
    setRequest(undefined);
  }

  return (
    <div className="backdrop confirm-backdrop" onClick={() => close(false)}>
      <div className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title"><TriangleAlert size={20} aria-hidden="true" /> {request.title}</h2>
        <p id="confirm-message" className="muted">{request.message}</p>
        <div className="confirm-actions">
          <button className="button" autoFocus onClick={() => close(false)}>Cancel</button>
          <button className="button danger" onClick={() => close(true)}>{request.action}</button>
        </div>
      </div>
    </div>
  );
}
