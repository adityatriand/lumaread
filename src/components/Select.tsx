import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface Option { value: string; label: string }

interface Props {
  label: string; // accessible name
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string; // shown when value matches no option (e.g. "Chapters")
  className?: string;
}

// Select-only combobox (WAI-ARIA pattern) so the dropdown matches the app on every platform instead of the OS picker
export function Select({ label, value, options, onChange, placeholder, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.findIndex((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) rootRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    setActive(Math.max(0, selected));
    setOpen(true);
  }

  function choose(i: number) {
    onChange(options[i].value);
    setOpen(false);
  }

  function onKey(e: KeyboardEvent) {
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => (open ? setActive((a) => Math.min(last, a + 1)) : show()),
      ArrowUp: () => (open ? setActive((a) => Math.max(0, a - 1)) : show()),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => (open ? choose(active) : show()),
      " ": () => (open ? choose(active) : show()),
      Escape: () => setOpen(false),
      Tab: () => setOpen(false),
    };
    const run = keys[e.key];
    if (!run) return;
    if (e.key !== "Tab") e.preventDefault();
    run();
  }

  return (
    <div className={`select ${className}`} ref={rootRef}>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        className="select-button"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span className="select-value">{options[selected]?.label ?? placeholder ?? ""}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul className="select-list" role="listbox" id={listId} aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === selected}
              className={i === active ? "active" : undefined}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span>{o.label}</span>
              {i === selected && <Check size={16} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
