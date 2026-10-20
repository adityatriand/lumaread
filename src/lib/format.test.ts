import { describe, expect, it } from "vitest";
import { formatSize, timeAgo } from "./format";

describe("formatSize", () => {
  it("uses KB below 1 MB, never 0 KB", () => {
    expect(formatSize(10)).toBe("1 KB");
    expect(formatSize(320 * 1024)).toBe("320 KB");
  });
  it("uses one decimal MB above", () => {
    expect(formatSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
  });
});

describe("timeAgo", () => {
  const now = 1_000_000_000_000;
  it("picks the largest whole unit", () => {
    expect(timeAgo(now - 30_000, now)).toBe("just now");
    expect(timeAgo(now - 2 * 864e5, now)).toMatch(/2 days ago/);
    expect(timeAgo(now - 8 * 864e5, now)).toMatch(/last week|1 week ago/);
  });
});
