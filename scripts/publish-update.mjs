// Push the local installers to the `updates` branch, replacing whatever was there.
// master is left untouched, and the branch is one commit, so old builds are not kept in history.
// The installers are over GitHub's 100 MB git limit, so they go through Git LFS.
// Run after a local build: pnpm publish:update
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BRANCH = "updates";
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

function run(cmd, args, cwd, inherit = false) {
  try {
    return execFileSync(cmd, args, {
      cwd,
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
  [/^LumaRead_.*_aarch64\.dmg$/, "LumaRead-macos-aarch64.dmg"],
  [/^LumaRead_.*_x64\.dmg$/, "LumaRead-macos-x64.dmg"],
  [/^LumaRead_.*_arm64\.apk$/, "LumaRead-android-arm64.apk"],
];
const found = wanted.flatMap(([pattern, name]) => {
  const file = newest(pattern);
  return file ? [[file, name]] : [];
});
if (!found.length) throw new Error("Nothing to publish. Build a DMG or APK into release/ first.");

run("git", ["lfs", "version"], ROOT);
const remote = run("git", ["remote", "get-url", "origin"], ROOT).trim();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "lumaread-updates-"));

try {
  fs.writeFileSync(path.join(work, "version.txt"), `${version}\n`);
  fs.writeFileSync(path.join(work, ".gitattributes"), "*.dmg filter=lfs diff=lfs merge=lfs -text\n*.apk filter=lfs diff=lfs merge=lfs -text\n");
  for (const [file, name] of found) fs.copyFileSync(file, path.join(work, name));

  run("git", ["init"], work);
  run("git", ["checkout", "-b", BRANCH], work);
  run("git", ["lfs", "install", "--local"], work);
  run("git", ["add", ".gitattributes", "version.txt"], work);
  run("git", ["add", ...found.map(([, name]) => name)], work);

  for (const [, name] of found) {
    const stored = run("git", ["cat-file", "-p", `:${name}`], work);
    if (!stored.startsWith("version https://git-lfs.github.com/spec")) {
      throw new Error(`${name} was not stored with Git LFS. GitHub would reject a file this large.`);
    }
  }

  run("git", ["commit", "-m", `LumaRead ${version}`], work);
  run("git", ["push", "--force", remote, `HEAD:${BRANCH}`], work, true);
  console.log(`Replaced ${BRANCH} with ${version}: ${found.map(([, name]) => name).join(", ")}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
