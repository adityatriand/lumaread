# LumaRead

Personal reading library: import EPUB/PDF, read, highlight, take notes, look up and translate words, search everything. Ships as a macOS `.dmg` and an Android `.apk` from one Tauri 2 + React + TypeScript codebase.

Product and engineering docs: `others/docs/new-feature/lumaread/` (PRD, TRD, ADRs). The docs assume a cloud web app; this build is **on-device only** — see ADR-013…015 there.

## Features

- **Import** EPUB / PDF (magic-byte check, SHA-256 duplicate detection, 200 MB cap), cover thumbnails
- **Library**: Home (continue reading, recent files), Library (EPUB/PDF tabs), remove
- **PDF reader** (pdf.js viewer): pages, zoom presets, selectable text; JBIG2/JPEG 2000 scans, CJK and non-embedded fonts render offline
- **EPUB reader** (epub.js): chapters, font size, line spacing, light/dark/sepia, Source Serif 4, book scripts disabled
- **Progress** saved as a versioned anchor (`src/lib/anchor.ts`) and restored on reopen
- **Highlights & notes**: 4 colours, notes on highlights or whole documents, copy quote with source; Notebook with jump-back
- **Export** highlights and notes to Markdown / CSV through the system save dialog (CSV is formula-safe, UTF-8 BOM)
- **Search** titles, book text, highlights and notes (accent/case-insensitive), opens the page or chapter
- **OCR** for scanned PDFs (tesseract.js, Indonesian + English): the page being read is recognised automatically, "Recognize all pages" makes the whole book searchable; recognised words are selectable and highlightable
- **Dictionary** (Open English WordNet, Indonesian Wiktionary) with Indonesian root finding (`menatap` → `tatap`)
- **Translation** Indonesian ⇄ English with Mozilla's Bergamot models, entirely on-device
- **Share quote cards**: any selection or highlight becomes a 1080×1920 story or 1080×1080 square image (Luma / Paper / Night). Android opens the system share sheet (Instagram Stories, WhatsApp Status, …) via the local `src-tauri/plugins/quoteshare` plugin; desktop saves or copies the image
- App-only: in a plain browser `src/main.tsx` shows only an "open the app" screen

Everything — files, metadata, progress, highlights, OCR results — lives in the app webview's IndexedDB (`src/lib/db.ts`). Nothing leaves the device. Uninstalling the app deletes the library; export is the backup.

## Setup

```sh
pnpm install
pnpm setup:data   # once: builds data/dictionaries (~16 MB) and downloads + verifies data/translation (~41 MB)
```

`data/` output is generated, not committed (only `data/dictionaries/ATTRIBUTION.md`). The build fails with a hint if it is missing.

## Commands

```sh
pnpm tauri dev                 # desktop dev window
pnpm build                     # type-check + web build
pnpm test                      # unit (vitest)
pnpm test:e2e                  # Playwright against `vite preview` with the app CSP, uses installed Google Chrome

pnpm tauri build --bundles dmg # → src-tauri/target/release/bundle/dmg/

# Android (needs Android SDK + NDK)
export ANDROID_HOME=$HOME/Library/Android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/29.0.14206865
pnpm tauri android dev
pnpm tauri android build --apk --debug --target aarch64
```

Release APKs need a signing keystore — not configured yet. E2E tests stub `globalThis.isTauri` and Tauri's IPC to drive the UI in Chrome.

## Layout

```
src/lib/                 db.ts (IndexedDB v3), anchor.ts, pdf.ts, rects.ts, saveFile.ts
src/features/library/    import, Home, Library
src/features/reader/     ReaderView (selection, highlights), PdfReader, EpubReader — engines only emit/draw anchors
src/features/notebook/   Highlights & Notes, editor, Markdown/CSV export
src/features/search/     text indexing (+ scanned-PDF detection), search
src/features/ocr/        tesseract worker, selectable OCR text layer
src/features/lookup/     dictionary, stemmers, Bergamot translation client, panel
src/features/share/      quote card renderer (canvas) and share dialog
src/features/settings/   reading prefs, privacy, licences
scripts/                 build-dictionaries.mjs, fetch-translation-models.mjs
vite.config.ts           vendor-assets plugin: serves pdf.js / tesseract / Bergamot / data files at /vendor/*
src-tauri/               Rust shell, CSP, capabilities (save dialog + write chosen file + quote share), Android project in gen/android
src-tauri/plugins/quoteshare/  Android share sheet: writes the card to cache, shares it via FileProvider (no storage permission)
```

App size added by offline features: pdf.js assets 3.5 MB, OCR 7.8 MB, dictionaries ~16 MB (JSON, compresses well), translation ~46 MB.
