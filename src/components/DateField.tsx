import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

interface Props {
  label: string;
  value: string; // YYYY-MM-DD
  max: string;
  onChange: (day: string) => void;
  align?: "start" | "end";
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parts = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m: m - 1, d };
};

function shown(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function spoken(y: number, m: number, d: number) {
  return new Date(y, m, d, 12).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

// App calendar, the same height as the other filters. The system date picker is a small native popup.
export function DateField({ label, value, max, onChange, align = "start" }: Props) {
  const [open, setOpen] = useState(false);
  const initial = parts(value);
  const [cursor, setCursor] = useState({ y: initial.y, m: initial.m });
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const selected = parts(value);
  const limit = parts(max);
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const lead = new Date(cursor.y, cursor.m, 1).getDay();
  const monthLabel = new Date(cursor.y, cursor.m, 1, 12).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const atMaxMonth = cursor.y > limit.y || (cursor.y === limit.y && cursor.m >= limit.m);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function show() {
    const at = parts(value);
    setCursor({ y: at.y, m: at.m });
    setOpen(true);
  }

  function shift(delta: number) {
    const next = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: next.getFullYear(), m: next.getMonth() });
  }

  return (
    <div className={`date-field${align === "end" ? " end" : ""}`} ref={rootRef}>
      <button type="button" className="date-button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())}>
        <span className="muted">{label}</span>
        <span>{shown(value)}</span>
      </button>
      {open && (
        <div className="date-pop" role="dialog" aria-label={label} aria-labelledby={titleId}>
          <div className="date-nav">
            <button type="button" className="icon-button" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={20} /></button>
            <strong id={titleId}>{monthLabel}</strong>
            <button type="button" className="icon-button" aria-label="Next month" disabled={atMaxMonth} onClick={() => shift(1)}><ChevronRight size={20} /></button>
          </div>
          <div className="date-grid">
            {WEEKDAYS.map((name) => <span key={name} className="date-dow">{name}</span>)}
            {Array.from({ length: lead }, (_, i) => <span key={`pad-${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1;
              const key = keyOf(cursor.y, cursor.m, day);
              const pressed = cursor.y === selected.y && cursor.m === selected.m && day === selected.d;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={spoken(cursor.y, cursor.m, day)}
                  data-date={key}
                  aria-pressed={pressed}
                  disabled={key > max}
                  onClick={() => (onChange(key), setOpen(false))}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
