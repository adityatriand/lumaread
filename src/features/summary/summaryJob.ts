import type { ExtractedSummary } from "./summarize";

export type JobProgress = { message?: string; done?: number; total?: number };

type Listener = (p: JobProgress) => void;

type Job = {
  docId: string;
  promise: Promise<ExtractedSummary>;
  last: JobProgress;
  listeners: Set<Listener>;
};

let active: Job | undefined;

export function getSummaryJob(docId: string): Job | undefined {
  return active?.docId === docId ? active : undefined;
}

/** One AI rewrite per doc — reopen attaches instead of restarting from 1. */
export function runSummaryJob(
  docId: string,
  run: (report: (p: JobProgress) => void) => Promise<ExtractedSummary>,
): Promise<ExtractedSummary> {
  const existing = getSummaryJob(docId);
  if (existing) return existing.promise;

  const listeners = new Set<Listener>();
  const job: Job = {
    docId,
    last: {},
    listeners,
    promise: Promise.resolve().then(() =>
      run((p) => {
        job.last = { ...job.last, ...p };
        for (const l of listeners) l(job.last);
      }),
    ),
  };
  active = job;
  job.promise.finally(() => {
    if (active === job) active = undefined;
  });
  return job.promise;
}

export function subscribeSummaryJob(docId: string, listener: Listener): () => void {
  const job = getSummaryJob(docId);
  if (!job) return () => undefined;
  job.listeners.add(listener);
  listener(job.last);
  return () => {
    job.listeners.delete(listener);
  };
}
