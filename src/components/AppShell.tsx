import { Highlighter, House, LibraryBig, Search, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./Logo";

export type View = "home" | "library" | "notebook" | "search" | "settings";

const NAV = [
  { view: "home", label: "Home", Icon: House },
  { view: "library", label: "Library", Icon: LibraryBig },
  { view: "notebook", label: "Highlights", Icon: Highlighter },
  { view: "search", label: "Search", Icon: Search },
  { view: "settings", label: "Settings", Icon: Settings },
] as const;

interface Props { view: View; onNavigate: (v: View) => void; children: ReactNode }

export function AppShell({ view, onNavigate, children }: Props) {
  const links = NAV.map(({ view: v, label, Icon }) => (
    <button key={v} className="nav-item" aria-current={view === v ? "page" : undefined} onClick={() => onNavigate(v)}>
      <Icon size={18} aria-hidden="true" /> <span>{label}</span>
    </button>
  ));

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <Logo />
        {links}
      </nav>
      <main className="shell-main">
        <div className="mobile-brand"><Logo /></div>
        {children}
      </main>
      <nav className="tabbar" aria-label="Main">{links}</nav>
    </div>
  );
}
