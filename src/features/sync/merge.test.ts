import { describe, expect, it } from "vitest";
import type { Annotation } from "../../lib/db";
import { planMerge, type SyncState } from "./merge";

const empty = (): SyncState => ({ docs: [], removed: [], progress: [], annotations: [], bookmarks: [], sessions: [], tombstones: [] });
const doc = (hash: string, extra = {}) => ({ hash, title: hash, format: "pdf" as const, size: 1, addedAt: 1, ...extra });
const note = (id: string, updatedAt: number, extra: Partial<Annotation> = {}) => ({ id, doc: "A", color: "yellow" as const, createdAt: 1, updatedAt, version: 1, ...extra });
const progress = (doc: string, updatedAt: number, page: number) => ({ doc, anchor: { v: 1 as const, kind: "pdf" as const, page }, percent: page / 10, label: `Page ${page}`, updatedAt, version: 1 });

describe("sync merge", () => {
  it("fetches books missing here, except ones removed on this device", () => {
    const local = { ...empty(), docs: [doc("A")], removed: ["C"] };
    const remote = { ...empty(), docs: [doc("A"), doc("B"), doc("C")] };
    expect(planMerge(local, remote).fetch.map((d) => d.hash)).toEqual(["B"]);
  });

  it("takes the newer reading position per book, from either side", () => {
    const local = { ...empty(), docs: [doc("A"), doc("B")], progress: [progress("A", 100, 3), progress("B", 300, 9)] };
    const remote = { ...empty(), docs: [doc("A"), doc("B")], progress: [progress("A", 200, 7), progress("B", 250, 5)] };
    expect(planMerge(local, remote).put.progress.map((p) => [p.doc, p.anchor])).toEqual([["A", { v: 1, kind: "pdf", page: 7 }]]);
  });

  it("brings over new and newer highlights, keeps newer local edits", () => {
    const local = { ...empty(), docs: [doc("A")], annotations: [note("n1", 50), note("n2", 90)] };
    const remote = { ...empty(), docs: [doc("A")], annotations: [note("n1", 60, { note: "edited there" }), note("n2", 80), note("n3", 10)] };
    expect(planMerge(local, remote).put.annotations.map((a) => a.id)).toEqual(["n1", "n3"]);
  });

  it("a deletion on the other device removes the record here unless it was edited after", () => {
    const local = { ...empty(), docs: [doc("A")], annotations: [note("old", 10), note("edited", 99)] };
    const remote = {
      ...empty(),
      docs: [doc("A")],
      tombstones: [
        { key: "annotation:old", kind: "annotation" as const, id: "old", deletedAt: 50 },
        { key: "annotation:edited", kind: "annotation" as const, id: "edited", deletedAt: 50 },
      ],
    };
    const plan = planMerge(local, remote);
    expect(plan.remove.annotations).toEqual(["old"]);
    expect(plan.tombstones).toHaveLength(2);
  });

  it("a deletion here stops the other device's older copy from coming back", () => {
    const local = { ...empty(), docs: [doc("A")], tombstones: [{ key: "bookmark:b1", kind: "bookmark" as const, id: "b1", deletedAt: 50 }] };
    const remote = { ...empty(), docs: [doc("A")], bookmarks: [{ id: "b1", doc: "A", anchor: { v: 1 as const, kind: "pdf" as const, page: 2 }, label: "Page 2", name: "x", createdAt: 10 }] };
    expect(planMerge(local, remote).put.bookmarks).toEqual([]);
  });

  it("a reset (progress tombstone) wins over an older position from the other device", () => {
    const local = { ...empty(), docs: [doc("A")], tombstones: [{ key: "progress:A", kind: "progress" as const, id: "A", deletedAt: 500 }] };
    const remote = { ...empty(), docs: [doc("A")], progress: [progress("A", 400, 8)] };
    expect(planMerge(local, remote).put.progress).toEqual([]);
    expect(planMerge(local, { ...remote, progress: [progress("A", 600, 2)] }).put.progress).toHaveLength(1);
  });

  it("never passes on book removals, and skips records of books this device won't have", () => {
    const local = { ...empty(), removed: ["B"] };
    const remote = {
      ...empty(),
      docs: [doc("B")],
      annotations: [note("n1", 5, {}), { ...note("n2", 5), doc: "B" }],
      tombstones: [{ key: "doc:Z", kind: "doc" as const, id: "Z", deletedAt: 1 }],
    };
    const plan = planMerge(local, remote);
    expect(plan.put.annotations).toEqual([]);
    expect(plan.tombstones).toEqual([]);
  });

  it("newest title/author edit wins; sessions take the longer copy", () => {
    const local = { ...empty(), docs: [doc("A", { title: "Old", editedAt: 1 })], sessions: [{ id: "s", doc: "A", day: "2026-10-20", startedAt: 0, endedAt: 100, activeMs: 50, pages: 1, startPercent: 0, endPercent: 0.1 }] };
    const remote = { ...empty(), docs: [doc("A", { title: "New", editedAt: 2 })], sessions: [{ ...local.sessions[0], endedAt: 200, activeMs: 120 }] };
    const plan = planMerge(local, remote);
    expect(plan.docPatches).toEqual([{ hash: "A", patch: { title: "New", author: undefined, editedAt: 2 } }]);
    expect(plan.put.sessions[0].activeMs).toBe(120);
  });
});
