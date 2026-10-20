import { useEffect, useRef, useState } from "react";

export interface Point { key: string; label: string; title: string; value: number }

const H = 180; // plot height in px
const TOP = 20; // headroom so the peak's value label is never clipped
const AXIS = 36; // room for y tick labels
const BOTTOM = 24; // room for x labels
const MAX_BAR = 24;

// Round the axis top up to a clean step (minutes-friendly) with at most 4 ticks
export function niceTicks(max: number): number[] {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 180, 300, 600];
  const step = steps.find((s) => max / s <= 4) ?? Math.ceil(max / 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

// Column with a 4px rounded data end and a square baseline
function columnPath(x: number, w: number, top: number, base: number) {
  const r = Math.min(4, w / 2, base - top);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

interface ColumnProps { data: Point[]; format: (v: number) => string; unit: (v: number) => number; unitLabel: string; label: string }

// Laid out in real pixels (not a stretched viewBox) so text and rounded ends never distort
function useWidth() {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// Single series → no legend; the card title names it. Each column is its own hover/focus target.
export function ColumnChart({ data, format, unit, unitLabel, label }: ColumnProps) {
  const [ref, measured] = useWidth();
  const [active, setActive] = useState<number>();
  const values = data.map((d) => unit(d.value));
  const ticks = niceTicks(Math.max(1, ...values));
  const top = ticks.at(-1)!;
  const width = Math.max(measured, 240);
  const slot = (width - AXIS) / data.length;
  const bar = Math.max(2, Math.min(MAX_BAR, slot - 2)); // 2px surface gap between neighbours
  const y = (v: number) => TOP + H - (v / top) * H;
  const base = TOP + H;
  const peak = values.indexOf(Math.max(...values));
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor((width - AXIS) / 56))); // ~56px per x label

  return (
    <figure className="chart" aria-label={label} ref={ref}>
      <svg width={width} height={base + BOTTOM} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={AXIS} x2={width} y1={y(t)} y2={y(t)} />
            <text className="tick" x={AXIS - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">{t}</text>
          </g>
        ))}
        <text className="tick" x={0} y={TOP / 2} dominantBaseline="middle">{unitLabel}</text>
        {data.map((d, i) => {
          const x = AXIS + i * slot + (slot - bar) / 2;
          const v = values[i];
          return (
            <g
              key={d.key}
              tabIndex={0}
              role="img"
              aria-label={`${d.title}: ${format(d.value)}`}
              className={`col${active === i ? " active" : ""}`}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(undefined)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(undefined)}
            >
              {/* Hit area spans the whole slot so short bars are easy to hover */}
              <rect className="hit" x={AXIS + i * slot} y={0} width={slot} height={base} />
              {v > 0 && <path className="bar" d={columnPath(x, bar, y(v), base)} />}
              {i % labelEvery === 0 && (
                <text className="tick" x={x + bar / 2} y={base + 16} textAnchor="middle">{d.label}</text>
              )}
              {i === peak && v > 0 && (
                <text className="value" x={x + bar / 2} y={y(v) - 6} textAnchor="middle">{format(d.value)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {active !== undefined && (
        // Sits just above the hovered column (clamped inside the chart) instead of covering the peak label
        <div className="chart-tip" style={{ left: AXIS + active * slot + slot / 2, top: Math.max(0, y(values[active]) - 60) }} role="status">
          <strong>{format(data[active].value)}</strong>
          <span>{data[active].title}</span>
        </div>
      )}
    </figure>
  );
}

interface BarListProps { rows: { key: string; label: string; value: number }[]; format: (v: number) => string; label: string }

export function BarList({ rows, format, label }: BarListProps) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bar-list" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${format(r.value)}`}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            <span className="bar-value">{format(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// Same numbers as the chart, reachable without hovering
export function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <table className="data-table">
      <caption>{caption}</caption>
      <thead>
        <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
