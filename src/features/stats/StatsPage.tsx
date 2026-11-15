import { Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listSessions, type Session } from "../../lib/db";
import { timeAgo } from "../../lib/format";
import { ProgressBar } from "../library/DocRow";
import type { LibraryItem } from "../library/types";
import { DateField } from "../../components/DateField";
import { Select } from "../../components/Select";
import { ShareImageDialog } from "../share/ShareImageDialog";
import { achievementCaption, renderAchievement, type Achievement, type StatVariant } from "./achievementCard";
import { BarList, DataTable } from "./charts";
import { byDay, dayKey, daysBetween, estimateRemainingMs, formatDuration, lastDays, streaks, summarize, timeByBook } from "./stats";

interface Props { items: LibraryItem[]; docId: string; onDocChange: (id: string) => void; onOpen: (item: LibraryItem) => void }

const TOP_BOOKS = 6;
const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = (day: string, year: boolean) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: year ? "numeric" : undefined });

function periodLabel(from: string, to: string): string {
  if (from === to) return longDay(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${shortDay(from, !sameYear)} – ${shortDay(to, true)}`;
}

const VARIANTS: { id: StatVariant; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "time", label: "Time" },
  { id: "pages", label: "Pages" },
  { id: "streak", label: "Streak" },
  { id: "pace", label: "Pace" },
  { id: "book", label: "Book" },
];

export function StatsPage({ items, docId, onDocChange, onOpen }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const today = dayKey(Date.now());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    listSessions().then(setSessions, () => setSessions([]));
  }, []);

  const item = items.find((i) => i.doc.id === docId);
  const byDoc = useMemo(() => new Map(items.map((i) => [i.doc.id, i])), [items]);
  // Sessions of removed books are deleted with them; the filter guards a race with that
  const forBook = sessions.filter((s) => byDoc.has(s.docId) && (!docId || s.docId === docId));
  const days = daysBetween(from, to);
  const rangeStart = days[0];
  const rangeEnd = days[days.length - 1];
  const inRange = forBook.filter((s) => s.day >= rangeStart && s.day <= rangeEnd);
  const summary = summarize(inRange);
  const streak = streaks(forBook);
  const period = periodLabel(rangeStart, rangeEnd);
  const week = lastDays(7);
  const month = lastDays(30);
  const preset = from === today && to === today ? "day" : from === week[0] && to === today ? "week" : from === month[0] && to === today ? "month" : "";

  function applyRange(start: string, end: string) {
    if (!start || !end) return;
    if (start > end) [start, end] = [end, start];
    setFrom(start);
    setTo(end);
  }

  const allTime = summarize(forBook);
  const percent = item?.progress?.percent ?? 0;
  const remaining = item && estimateRemainingMs(forBook, percent);
  const finished = items.filter((i) => (i.progress?.percent ?? 0) >= 0.99).length;

  const books = timeByBook(inRange);
  const bookRows = [
    ...books.slice(0, TOP_BOOKS).map((b) => ({ key: b.docId, label: byDoc.get(b.docId)!.doc.title, value: b.ms })),
    ...(books.length > TOP_BOOKS ? [{ key: "other", label: `${books.length - TOP_BOOKS} other books`, value: books.slice(TOP_BOOKS).reduce((a, b) => a + b.ms, 0) }] : []),
  ];

  const perDay = byDay(inRange, days);
  const achievement: Achievement = {
    period,
    book: item && { title: item.doc.title, author: item.doc.author, percent },
    ms: summary.ms,
    pages: summary.pages,
    streak: streak.current,
    daysRead: summary.daysRead,
    pagesPerHour: summary.pagesPerHour,
    daily: perDay.map((d) => d.ms),
    dailyPages: perDay.map((d) => d.pages),
    days,
  };
  const variants = VARIANTS.filter((v) => (v.id === "book" ? !!item : v.id === "pace" ? summary.pagesPerHour != null : true));

  return (
    <div className="screen">
      <header className="page-header">
        <h1>Reading stats</h1>
        <button className="button" onClick={() => setSharing(true)} disabled={!summary.ms}><Share2 size={16} /> Share achievement</button>
      </header>

      <div className="filter-row">
        <Select
          label="Book"
          className="doc-filter"
          value={docId}
          options={[{ value: "", label: "All books" }, ...items.map((i) => ({ value: i.doc.id, label: i.doc.title }))]}
          onChange={onDocChange}
        />
        <div className="segmented" role="radiogroup" aria-label="Range">
          <button role="radio" aria-checked={preset === "day"} aria-pressed={preset === "day"} onClick={() => applyRange(today, today)}>Today</button>
          <button role="radio" aria-checked={preset === "week"} aria-pressed={preset === "week"} onClick={() => applyRange(week[0], today)}>Week</button>
          <button role="radio" aria-checked={preset === "month"} aria-pressed={preset === "month"} onClick={() => applyRange(month[0], today)}>Month</button>
        </div>
        <DateField label="From" value={from} max={today} onChange={(day) => applyRange(day, to)} />
        <DateField label="To" value={to} max={today} align="end" onChange={(day) => applyRange(from, day)} />
      </div>

      {!forBook.length ? (
        <section className="card empty">
          <h2>No reading yet</h2>
          <p className="muted">Open a book and read for a minute — your time, pages and streaks will show up here.</p>
        </section>
      ) : (
        <>
          <section className="card hero-card">
            <span className="muted small">Reading time · {period}</span>
            <span className="hero-figure">{formatDuration(summary.ms)}</span>
            <div className="stat-tiles">
              <div className="stat"><span className="muted small">Pages read</span><strong>{summary.pages.toLocaleString()}</strong></div>
              <div className="stat"><span className="muted small">Current streak</span><strong>{streak.current} {streak.current === 1 ? "day" : "days"}</strong><span className="muted small">Best {streak.longest}</span></div>
              <div className="stat"><span className="muted small">Sessions</span><strong>{summary.sessions}</strong></div>
              <div className="stat">
                <span className="muted small">{item ? "Pace" : "Books finished"}</span>
                <strong>{item ? (summary.pagesPerHour ? `${summary.pagesPerHour} pages/h` : "—") : finished}</strong>
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
            <h2>Sessions</h2>
            {inRange.length === 0 ? (
              <p className="muted">No reading in this range.</p>
            ) : (
              <ul className="session-list">
                {inRange.map((s) => (
                  <li key={s.id}>
                    <span>{byDoc.get(s.docId)!.doc.title}</span>
                    {rangeStart !== rangeEnd && <span className="muted">{shortDay(s.day, false)}</span>}
                    <span>{formatDuration(s.activeMs)}</span>
                    <span className="muted">{s.pages} {s.pages === 1 ? "page" : "pages"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!item && bookRows.length > 0 && (
            <section className="card">
              <h2>Time by book</h2>
              <BarList label={`Reading time by book on ${period}`} rows={bookRows} format={formatDuration} />
              <DataTable caption="Time by book" columns={["Book", "Time"]} rows={bookRows.map((r) => [r.label, formatDuration(r.value)])} />
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
          chart
          variants={variants}
          render={(format, theme, chart, sticker) => renderAchievement(achievement, format, theme, chart, sticker)}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}
