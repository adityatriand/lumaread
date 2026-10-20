import { Share2, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listSessions, type Session } from "../../lib/db";
import { timeAgo } from "../../lib/format";
import { ProgressBar } from "../library/DocRow";
import type { LibraryItem } from "../library/types";
import { ShareImageDialog } from "../share/ShareImageDialog";
import { achievementCaption, renderAchievement, type Achievement } from "./achievementCard";
import { BarList, ColumnChart, DataTable } from "./charts";
import { byDay, estimateRemainingMs, formatDuration, lastDays, streaks, summarize, timeByBook } from "./stats";

interface Props { items: LibraryItem[]; docId: string; onDocChange: (id: string) => void; onOpen: (item: LibraryItem) => void }

const RANGES = [7, 30, 90] as const;
const TOP_BOOKS = 6;

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

export function StatsPage({ items, docId, onDocChange, onOpen }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [range, setRange] = useState<(typeof RANGES)[number]>(7);
  const [tables, setTables] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    listSessions().then(setSessions, () => setSessions([]));
  }, []);

  const item = items.find((i) => i.doc.id === docId);
  const byDoc = useMemo(() => new Map(items.map((i) => [i.doc.id, i])), [items]);
  // Sessions of removed books are deleted with them; the filter guards a race with that
  const scoped = sessions.filter((s) => byDoc.has(s.docId) && (!docId || s.docId === docId));
  const days = lastDays(range);
  const inRange = scoped.filter((s) => s.day >= days[0]);
  const daily = byDay(inRange, days);
  const summary = summarize(inRange);
  const streak = streaks(scoped);
  const period = `Last ${range} days`;

  const allTime = summarize(scoped);
  const percent = item?.progress?.percent ?? 0;
  const remaining = item && estimateRemainingMs(scoped, percent);
  const finished = items.filter((i) => (i.progress?.percent ?? 0) >= 0.99).length;

  const books = timeByBook(inRange);
  const bookRows = [
    ...books.slice(0, TOP_BOOKS).map((b) => ({ key: b.docId, label: byDoc.get(b.docId)!.doc.title, value: b.ms })),
    // Long tails fold into "Other" so the list stays scannable
    ...(books.length > TOP_BOOKS ? [{ key: "other", label: `${books.length - TOP_BOOKS} other books`, value: books.slice(TOP_BOOKS).reduce((a, b) => a + b.ms, 0) }] : []),
  ];

  const achievement: Achievement = {
    period,
    book: item && { title: item.doc.title, author: item.doc.author, percent },
    ms: summary.ms,
    pages: summary.pages,
    streak: streak.current,
    daysRead: summary.daysRead,
    daily: daily.map((d) => d.ms),
  };

  return (
    <div className="screen">
      <header className="page-header">
        <h1>Reading stats</h1>
        <button className="button" onClick={() => setSharing(true)} disabled={!summary.ms}><Share2 size={16} /> Share achievement</button>
      </header>

      <div className="filter-row">
        <select aria-label="Book" value={docId} onChange={(e) => onDocChange(e.target.value)}>
          <option value="">All books</option>
          {items.map((i) => <option key={i.doc.id} value={i.doc.id}>{i.doc.title}</option>)}
        </select>
        <div className="segmented" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r} role="radio" aria-checked={range === r} aria-pressed={range === r} onClick={() => setRange(r)}>{r} days</button>
          ))}
        </div>
      </div>

      {!scoped.length ? (
        <section className="card empty">
          <h2>No reading yet</h2>
          <p className="muted">Open a book and read for a minute — your time, pages and streaks will show up here.</p>
        </section>
      ) : (
        <>
          <section className="card hero-card">
            <span className="muted small">Reading time · {period.toLowerCase()}</span>
            <span className="hero-figure">{formatDuration(summary.ms)}</span>
            <div className="stat-tiles">
              <div className="stat"><span className="muted small">Pages read</span><strong>{summary.pages.toLocaleString()}</strong></div>
              <div className="stat"><span className="muted small">Current streak</span><strong>{streak.current} {streak.current === 1 ? "day" : "days"}</strong><span className="muted small">Best {streak.longest}</span></div>
              <div className="stat"><span className="muted small">Days read</span><strong>{summary.daysRead} / {range}</strong></div>
              <div className="stat">
                <span className="muted small">{item ? "Pace" : "Books finished"}</span>
                <strong>{item ? (allTime.pagesPerHour ? `${allTime.pagesPerHour} pages/h` : "—") : finished}</strong>
              </div>
            </div>
          </section>

          {item && (
            <section className="card">
              <h2>Progress</h2>
              <div className="progress-detail">
                <span className="hero-small">{Math.round(percent * 100)}%</span>
                <ProgressBar percent={percent} />
              </div>
              <p className="muted">
                {item.progress?.label ? `Last read: ${item.progress.label}` : "Not opened yet"}
                {item.doc.openedAt ? ` · ${timeAgo(item.doc.openedAt)}` : ""}
                {item.doc.pageCount ? ` · ${item.doc.pageCount} pages` : ""}
              </p>
              <p className="muted">
                Total {formatDuration(allTime.ms)} over {allTime.sessions} {allTime.sessions === 1 ? "session" : "sessions"}
                {remaining ? ` · about ${formatDuration(remaining)} left at your pace` : ""}
              </p>
              <button className="button" onClick={() => onOpen(item)}>Continue reading</button>
            </section>
          )}

          <section className="card">
            <div className="section-header">
              <h2>Daily reading time</h2>
              <button className="link" onClick={() => setTables((t) => !t)} aria-pressed={tables}><Table2 size={14} /> {tables ? "Hide table" : "Table"}</button>
            </div>
            <ColumnChart
              label={`Daily reading time, ${period.toLowerCase()}`}
              data={daily.map((d) => ({ key: d.day, label: shortDay(d.day), title: `${longDay(d.day)} · ${d.pages} pages`, value: d.ms }))}
              format={formatDuration}
              unit={(ms) => Math.round(ms / 60_000)}
              unitLabel="min"
            />
            {tables && (
              <DataTable
                caption="Daily reading time"
                columns={["Day", "Time", "Pages"]}
                rows={daily.filter((d) => d.ms).map((d) => [longDay(d.day), formatDuration(d.ms), d.pages])}
              />
            )}
          </section>

          {!item && bookRows.length > 0 && (
            <section className="card">
              <h2>Time by book</h2>
              <BarList label={`Reading time by book, ${period.toLowerCase()}`} rows={bookRows} format={formatDuration} />
              {tables && <DataTable caption="Time by book" columns={["Book", "Time"]} rows={bookRows.map((r) => [r.label, formatDuration(r.value)])} />}
            </section>
          )}
        </>
      )}

      {sharing && (
        <ShareImageDialog
          heading="Share achievement"
          alt={`Reading achievement: ${achievementCaption(achievement)}`}
          caption={achievementCaption(achievement)}
          fileBase="lumaread-achievement"
          render={(format, theme) => renderAchievement(achievement, format, theme)}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}
