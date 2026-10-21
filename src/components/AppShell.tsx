import { ChartColumn, Ellipsis, Highlighter, House, LibraryBig, NotebookPen, Search, Settings } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "./Logo";

export type View = "home" | "library" | "notebook" | "notes" | "stats" | "search" | "settings";

type NavItem = { view: View; label: string; Icon: typeof House };

const SIDEBAR: NavItem[] = [
  { view: "home", label: "Home", Icon: House },
  { view: "library", label: "Library", Icon: LibraryBig },
  { view: "notebook", label: "Highlights", Icon: Highlighter },
  { view: "notes", label: "Notes", Icon: NotebookPen },
  { view: "stats", label: "Stats", Icon: ChartColumn },
  { view: "settings", label: "Settings", Icon: Settings },
];
// Phones get four tabs; the rest live under More
const TABS = SIDEBAR.slice(0, 3);
const MORE: NavItem[] = [SIDEBAR[3], SIDEBAR[4], { view: "search", label: "Search", Icon: Search }, SIDEBAR[5]];

interface Props { view: View; query: string; onNavigate: (v: View) => void; onSearch: (query: string) => void; children: ReactNode }

export function AppShell({ view, query, onNavigate, onSearch, children }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K jumps to search from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (v: View) => (setMoreOpen(false), onNavigate(v));
  const link = ({ view: v, label, Icon }: NavItem) => (
    <button key={v} className="nav-item" title={label} aria-current={view === v ? "page" : undefined} onClick={() => go(v)}>
      <Icon size={18} aria-hidden="true" /> <span>{label}</span>
    </button>
  );

  return (
    <div className="shell">
      <div className="drag-strip" data-tauri-drag-region />
      <nav className="app-sidebar" aria-label="Main">
        <Logo />
        {SIDEBAR.map(link)}
      </nav>
      <main className="shell-main">
        <div className="topbar">
          <label className="search-box top-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search your library…"
              aria-label="Search your library"
              value={query}
              onChange={(e) => onSearch(e.currentTarget.value)}
            />
            <kbd>⌘K</kbd>
          </label>
        </div>
        <div className="content">
          <div className="mobile-brand">
            <Logo />
            <button className="icon-button" aria-label="Search" onClick={() => go("search")}><Search size={20} /></button>
          </div>
          {children}
        </div>
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map(link)}
        <button className="nav-item" aria-expanded={moreOpen} aria-current={MORE.some((m) => m.view === view) ? "page" : undefined} onClick={() => setMoreOpen((o) => !o)}>
          <Ellipsis size={18} aria-hidden="true" /> <span>More</span>
        </button>
      </nav>
      {moreOpen && (
        <div className="backdrop sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <nav className="more-sheet" aria-label="More" onClick={(e) => e.stopPropagation()}>
            {MORE.map(link)}
          </nav>
        </div>
      )}
    </div>
  );
}
