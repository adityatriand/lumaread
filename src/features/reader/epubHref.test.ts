import { describe, expect, it } from "vitest";
import { resolveHref } from "./epubHref";

const spine = ["text/cover.xhtml", "text/ch02.xhtml", "other/ch02.xhtml.bak"];

describe("resolveHref", () => {
  it("maps nav-folder-relative links to package paths, keeping the fragment", () => {
    expect(resolveHref("ch02.xhtml#c2", spine)).toBe("text/ch02.xhtml#c2");
    expect(resolveHref("../text/cover.xhtml", spine)).toBe("text/cover.xhtml");
  });
  it("leaves already-valid paths, CFIs and unknown files alone", () => {
    expect(resolveHref("text/ch02.xhtml", spine)).toBe("text/ch02.xhtml");
    expect(resolveHref("epubcfi(/6/4!/4/2)", spine)).toBe("epubcfi(/6/4!/4/2)");
    expect(resolveHref("missing.xhtml", spine)).toBe("missing.xhtml");
  });
});
