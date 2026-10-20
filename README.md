# LumaRead

Personal reading library: import EPUB/PDF, read, highlight, take notes, look up and translate words, search everything. Ships as a macOS `.dmg` and an Android `.apk` from one Tauri 2 + React + TypeScript codebase.

## Features

- **Import** EPUB / PDF (magic-byte check, SHA-256 duplicate detection, 200 MB cap), cover thumbnails
- **Library**: Home (continue reading, recent files), Library (EPUB/PDF tabs), remove
- **PDF reader** (pdf.js viewer): pages, zoom presets, selectable text; JBIG2/JPEG 2000 scans, CJK and non-embedded fonts render offline
- **EPUB reader** (epub.js): chapters, font size, line spacing, light/dark/sepia, Source Serif 4, book scripts disabled
- **Reading layouts**: desktop — continuous scroll or side by side (book spreads, cover alone); phone — scroll up–down or swipe left–right. Page colour Light / Sepia / Dark applies to EPUB and PDF
- **App theme**: Light (default), Dark, or match the system — Settings → Appearance
- **Progress** saved as a versioned anchor (`src/lib/anchor.ts`) and restored on reopen
- **Highlights & notes**: 4 colours, notes on highlights or whole documents, copy quote with source; Notebook with jump-back
- **Export** highlights and notes to Markdown / CSV through the system save dialog (CSV is formula-safe, UTF-8 BOM)
- **Search** titles, book text, highlights and notes (accent/case-insensitive), opens the page or chapter
- **OCR** for scanned PDFs (tesseract.js, Indonesian + English): the page being read is recognised automatically, "Recognize all pages" makes the whole book searchable; recognised words are selectable and highlightable
- **Dictionary** (Open English WordNet, Indonesian Wiktionary) with Indonesian root finding (`menatap` → `tatap`)
- **Translation** Indonesian ⇄ English with Mozilla's Bergamot models, entirely on-device
- **Reading stats**: active reading time (only while the window is visible and you interacted in the last 2 minutes), pages read, last position, % complete, streaks, pace and time left — for all books or one, over 7/30/90 days, with charts and table views. Achievements share as story/square cards like quotes
- **Share quote cards**: any selection or highlight becomes a 1080×1920 story or 1080×1080 square image (Luma / Paper / Night). Android opens the system share sheet (Instagram Stories, WhatsApp Status, …) via the local `src-tauri/plugins/quoteshare` plugin; desktop saves or copies the image
- WebKit note: the macOS webview can't `for await` a ReadableStream, which pdf.js uses for text extraction; `src/lib/pdf.ts` polyfills it (without it, search indexing and scanned-PDF detection — and so OCR — silently fail in the app). The Vite build also refuses any script with `%PDF` in its first 1 KB, because Tauri would serve it as `application/pdf`
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

E2E tests stub `globalThis.isTauri` and Tauri's IPC to drive the UI in Chrome.

## Release

```sh
pnpm tauri build --target universal-apple-darwin --bundles dmg   # needs: rustup target add x86_64-apple-darwin
pnpm tauri android build --apk                                    # signed universal APK
```

- **macOS**: ad-hoc signed (`bundle.macOS.signingIdentity: "-"`), macOS 13.3+. Without a Developer ID the first launch shows
  "unidentified developer" — right-click the app → Open once. Notarized builds need an Apple Developer account.
- **Android**: signed with the release key in `~/.lumaread-release/` (`lumaread-release.jks` + `keystore.properties`), read by
  `src-tauri/gen/android/app/build.gradle.kts`; set `LUMAREAD_KEYSTORE_PROPERTIES` to use another location (CI). Nothing secret is in
  the repo. **Back up that folder** — without it no update can ever be signed for installed apps.
- Version lives in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`; Android's versionCode is derived from it.

## Layout

```
src/lib/                 db.ts (IndexedDB v4), anchor.ts, pdf.ts, rects.ts, saveFile.ts
src/features/library/    import, Home, Library
src/features/reader/     ReaderView (selection, highlights), PdfReader, EpubReader — engines only emit/draw anchors
src/features/notebook/   Highlights & Notes, editor, Markdown/CSV export
src/features/search/     text indexing (+ scanned-PDF detection), search
src/features/ocr/        tesseract worker, selectable OCR text layer
src/features/lookup/     dictionary, stemmers, Bergamot translation client, panel
src/features/stats/      reading sessions, aggregates, charts, Stats page, achievement card
src/features/share/      card canvas (background + watermark), quote card, generic share dialog
src/features/settings/   reading prefs, privacy, licences
scripts/                 build-dictionaries.mjs, fetch-translation-models.mjs
vite.config.ts           vendor-assets plugin: serves pdf.js / tesseract / Bergamot / data files at /vendor/*
src-tauri/               Rust shell, CSP, capabilities (save dialog + write chosen file + quote share), Android project in gen/android
src-tauri/plugins/quoteshare/  Android share sheet: writes the card to cache, shares it via FileProvider (no storage permission)
```

App size added by offline features: pdf.js assets 3.5 MB, OCR 7.8 MB, dictionaries ~16 MB (JSON, compresses well), translation ~46 MB.
