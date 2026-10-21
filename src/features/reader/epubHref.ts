// Books whose nav document sits in a subfolder (text/nav.xhtml) give chapter links relative to that folder
// ("ch02.xhtml#c2"), while epub.js looks sections up by package path ("text/ch02.xhtml") and fails with
// "No Section Found". Map such links onto the spine entry with the same file name.
export function resolveHref(target: string, spineHrefs: string[]): string {
  if (target.startsWith("epubcfi(")) return target;
  const [path, hash] = target.split("#");
  if (!path || spineHrefs.includes(path)) return target;
  const name = path.replace(/^(\.{1,2}\/)+/, "");
  const match = spineHrefs.find((h) => h === name || h.endsWith(`/${name}`));
  return match ? `${match}${hash ? `#${hash}` : ""}` : target;
}
