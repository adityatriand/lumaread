import { useEffect, type RefObject } from "react";

// Closes a popover on a press anywhere outside the given elements (its toggle button counts as inside)
export function useOutsideClose(open: boolean, close: () => void, ...inside: RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !inside.some((r) => r.current?.contains(e.target as Node)) && close();
    // A tap inside an EPUB chapter (an iframe) never reaches this document, but it takes focus from this window
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("blur", close);
    };
  }, [open]);
}
