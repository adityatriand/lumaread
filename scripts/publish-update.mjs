// Overwrite the installers in the Google Drive folder. The same names are
// replaced, so the folder does not grow and version.txt keeps its id.
// Run after a local build: pnpm publish:update
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTE = "lumaread";
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const rclone = ["/opt/homebrew/bin/rclone", "/usr/local/bin/rclone"].find((file) => fs.existsSync(file)) ?? "rclone";

function run(cmd, args, inherit = false) {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = `${error.stderr ?? ""}${error.stdout ?? ""}`.trim() || error.message;
    throw new Error(`${cmd} ${args.join(" ")} failed\n${detail}`);
  }
}

function newest(pattern) {
  const dir = path.join(ROOT, "release");
  const ranked = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((name) => pattern.test(name))
    .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return ranked.length ? path.join(dir, ranked[0].name) : undefined;
}

const wanted = [
  [/^LumaRead_.*_aarch64\.dmg$/, "LumaRead-macos-aarch64.dmg", "macos-aarch64"],
  [/^LumaRead_.*_x64\.dmg$/, "LumaRead-macos-x64.dmg", "macos-x64"],
  [/^LumaRead_.*_arm64\.apk$/, "LumaRead-android-arm64.apk", "android-arm64"],
];
const found = wanted.flatMap(([pattern, name, key]) => {
  const file = newest(pattern);
  return file ? [[file, name, key]] : [];
});
if (!found.length) throw new Error("Nothing to publish. Build a DMG or APK into release/ first.");

run(rclone, ["version"]);
for (const [file, name] of found) run(rclone, ["copyto", file, `${REMOTE}:${name}`], true);

const listed = JSON.parse(run(rclone, ["lsjson", `${REMOTE}:`]));
const idOf = (name) => {
  const row = listed.find((item) => item.Name === name || item.Path === name);
  if (!row?.ID) throw new Error(`${name} is missing from Drive after upload. Leave the existing file in place so its id does not change.`);
  return row.ID;
};
const manifest = path.join(os.tmpdir(), "lumaread-version.txt");
fs.writeFileSync(manifest, [version, ...found.map(([, name, key]) => `${key}=${idOf(name)}`)].join("\n") + "\n");
run(rclone, ["copyto", manifest, `${REMOTE}:version.txt`], true);
fs.rmSync(manifest, { force: true });
console.log(`Replaced Drive files with ${version}: ${found.map(([, name]) => name).join(", ")}`);
