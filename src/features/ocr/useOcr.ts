import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { listOcrPages, type OcrWord } from "../../lib/db";
import { recognizePage } from "./ocr";

export interface OcrStatus { recognized: number; total: number; busyPage?: number; wholeBook: boolean; failed?: boolean }

// Recognises scanned pages one at a time: the page being read first, the rest only when asked
export function useOcr(docId: string, enabled: boolean, onPageReady: (page: number, words: OcrWord[]) => void) {
  const cache = useRef(new Map<number, OcrWord[]>());
  const queue = useRef<number[]>([]);
  const pdfRef = useRef<PDFDocumentProxy>(null);
  const running = useRef(false);
  const alive = useRef(true);
  const readyRef = useRef(onPageReady);
  const [status, setStatus] = useState<OcrStatus>({ recognized: 0, total: 0, wholeBook: false });

  readyRef.current = onPageReady;

  useEffect(() => {
    alive.current = true;
    if (enabled) {
      listOcrPages(docId).then((pages) => {
        for (const p of pages) cache.current.set(p.page, p.words);
        setStatus((s) => ({ ...s, recognized: cache.current.size }));
        for (const p of pages) readyRef.current(p.page, p.words);
      });
    }
    return () => {
      alive.current = false;
      queue.current = [];
    };
  }, [docId, enabled]);

  async function drain() {
    if (running.current) return;
    running.current = true;
    while (alive.current && pdfRef.current && queue.current.length) {
      const n = queue.current.shift()!;
      if (cache.current.has(n)) continue;
      setStatus((s) => ({ ...s, busyPage: n }));
      try {
        const { words } = await recognizePage(docId, await pdfRef.current.getPage(n));
        cache.current.set(n, words);
        if (alive.current) readyRef.current(n, words);
      } catch {
        setStatus((s) => ({ ...s, failed: true }));
      }
      setStatus((s) => ({ ...s, recognized: cache.current.size, busyPage: undefined }));
    }
    running.current = false;
    if (alive.current) setStatus((s) => ({ ...s, wholeBook: false }));
  }

  return {
    status,
    words: (page: number) => cache.current.get(page),
    attach(pdf: PDFDocumentProxy) {
      pdfRef.current = pdf;
      setStatus((s) => ({ ...s, total: pdf.numPages }));
      drain();
    },
    // The visible page jumps the queue
    want(...pages: number[]) {
      if (!enabled) return;
      const fresh = pages.filter((p) => p >= 1 && !cache.current.has(p) && p <= (pdfRef.current?.numPages ?? Infinity));
      queue.current = [...fresh, ...queue.current.filter((p) => !fresh.includes(p))];
      drain();
    },
    recognizeAll() {
      const total = pdfRef.current?.numPages ?? 0;
      const rest = Array.from({ length: total }, (_, i) => i + 1).filter((p) => !cache.current.has(p) && !queue.current.includes(p));
      queue.current.push(...rest);
      setStatus((s) => ({ ...s, wholeBook: true, failed: false }));
      drain();
    },
  };
}
