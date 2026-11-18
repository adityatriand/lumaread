// One release command.
//   pnpm release                 bump, commit, push, build, upload with rclone, then delete build output
//   pnpm release --manual        same through the build, then copy the Drive names into ~/Downloads
//   pnpm release --finish        after a manual replace: write version.txt, then delete build output
//   pnpm release minor|major     bump that part instead of the patch
//   pnpm release --note "…"      extra sentence in the version commit
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const REMOTE = "lumaread";
const DOWNLOADS = path.join(os.homedir(), "Downloads");
const ANDROID_HOME = "/opt/homebrew/share/android-commandlinetools";
const WANTED = [
  [/^LumaRead_.*_aarch64\.dmg$/, "LumaRead-macos-aarch64.dmg", "macos-aarch64"],
  [/^LumaRead_.*_x64\.dmg$/, "LumaRead-macos-x64.dmg", "macos-x64"],
  [/^LumaRead_.*_arm64\.apk$/, "LumaRead-android-arm64.apk", "android-arm64"],
];
const VERSION_FILES = ["package.json", "README.md", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "scripts/release.mjs"];

const args = process.argv.slice(2);
const finish = args.includes("--finish");
const manual = args.includes("--manual");
const note = args.find((arg) => arg.startsWith("--note="))?.slice("--note=".length) ?? (args.includes("--note") ? args[args.indexOf("--note") + 1] : "");
const kind = args.find((arg) => ["patch", "minor", "major"].includes(arg)) ?? "patch";
if (manual && args.includes("--rclone")) {
  throw new Error("Pass either --manual or --rclone.");
}
if (args.includes("--note") && !note) throw new Error("Pass the commit note after --note.");

const env = {
  ...process.env,
  PATH: `${os.homedir()}/.cargo/bin:/opt/homebrew/bin:${process.env.PATH ?? ""}`,
  JAVA_HOME: "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
  ANDROID_HOME,
  NDK_HOME: `${ANDROID_HOME}/ndk/29.0.14206865`,
  CARGO_TARGET_DIR: path.join(ROOT, "src-tauri/target"),
  LUMAREAD_EMBED_SUMMARIZE: "1",
};
const rclone = ["/opt/homebrew/bin/rclone", "/usr/local/bin/rclone"].find((file) => fs.existsSync(file)) ?? "rclone";

function log(message) {
  fs.writeSync(1, `${message}\n`);
}

function run(cmd, cmdArgs, inherit = false) {
  try {
    return execFileSync(cmd, cmdArgs, {
      cwd: ROOT,
      encoding: "utf8",
      env,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = `${error.stderr ?? ""}${error.stdout ?? ""}`.trim() || error.message;
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed\n${detail}`);
  }
}

function version() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

function newest(pattern) {
  const dir = path.join(ROOT, "release");
  const ranked = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((name) => pattern.test(name))
    .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return ranked.length ? path.join(dir, ranked[0].name) : undefined;
}

function installers() {
  return WANTED.flatMap(([pattern, name, key]) => {
    const file = newest(pattern);
    return file ? [[file, name, key]] : [];
  });
}

function requireTools() {
  for (const file of [env.JAVA_HOME, env.NDK_HOME, path.join(ANDROID_HOME, "build-tools/37.0.0/aapt")]) {
    if (!fs.existsSync(file)) throw new Error(`Missing build tool: ${file}`);
  }
}

function assertClean() {
  const dirty = run("git", ["status", "--porcelain"]).split("\n").map((line) => line.trim()).filter(Boolean);
  const unexpected = dirty.filter((line) => !VERSION_FILES.some((file) => line.endsWith(file)));
  if (unexpected.length) {
    throw new Error(`Commit or stash other changes before releasing:\n${unexpected.join("\n")}`);
  }
}

function commitAndPush(next) {
  run("git", ["add", "--", ...VERSION_FILES]);
  const body = [`Bump to ${next}.`, note.trim()].filter(Boolean).join("\n\n");
  run("git", ["commit", "-m", body], true);
  run("git", ["push", "origin", "HEAD"], true);
  log(`Pushed ${next}.`);
}

function build(next) {
  requireTools();
  log(`Building macOS ${next}…`);
  run("pnpm", ["tauri", "build", "--target", "aarch64-apple-darwin", "--bundles", "dmg"], true);
  const dmg = path.join(ROOT, "src-tauri/target/aarch64-apple-darwin/release/bundle/dmg", `LumaRead_${next}_aarch64.dmg`);
  if (!fs.existsSync(dmg)) throw new Error(`DMG was not produced: ${dmg}`);
  fs.mkdirSync(path.join(ROOT, "release"), { recursive: true });
  fs.copyFileSync(dmg, path.join(ROOT, "release", `LumaRead_${next}_aarch64.dmg`));

  log(`Building Android ${next}…`);
  run("pnpm", ["tauri", "android", "build", "--apk", "--target", "aarch64"], true);
  const apk = path.join(ROOT, "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk");
  const badging = run(path.join(ANDROID_HOME, "build-tools/37.0.0/aapt"), ["dump", "badging", apk]);
  if (!badging.includes(`versionName='${next}'`)) throw new Error(`APK version is not ${next}.\n${badging.split("\n")[0]}`);
  fs.copyFileSync(apk, path.join(ROOT, "release", `LumaRead_${next}_arm64.apk`));
  log(`Built release/LumaRead_${next}_aarch64.dmg and release/LumaRead_${next}_arm64.apk.`);
}

function copyToDownloads(found) {
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  for (const [file, name] of found) {
    const dest = path.join(DOWNLOADS, name);
    fs.copyFileSync(file, dest);
    log(`Copied ${dest}`);
  }
}

function remoteListing() {
  return JSON.parse(run(rclone, ["lsjson", `${REMOTE}:`]));
}

function writeVersionTxt(found) {
  const listed = remoteListing();
  for (const [file, name] of found) {
    const row = listed.find((item) => item.Name === name || item.Path === name);
    const size = fs.statSync(file).size;
    if (!row?.ID) throw new Error(`${name} is not on Drive. Replace the existing file; do not upload a second copy.`);
    if (row.Size !== size) throw new Error(`${name} on Drive is ${row.Size} bytes, but the local build is ${size}. Replace that file before updating version.txt.`);
  }
  const idOf = (name) => listed.find((item) => item.Name === name || item.Path === name).ID;
  const manifest = path.join(os.tmpdir(), "lumaread-version.txt");
  fs.writeFileSync(manifest, [version(), ...found.map(([, name, key]) => `${key}=${idOf(name)}`)].join("\n") + "\n");
  log("Uploading version.txt…");
  run(rclone, ["copyto", manifest, `${REMOTE}:version.txt`], true);
  fs.rmSync(manifest, { force: true });
  log(`version.txt now says ${version()}.`);
}

function cleanup() {
  const removed = [
    path.join(ROOT, "src-tauri/target"),
    path.join(ROOT, "src-tauri/gen/android/app/build"),
    path.join(ROOT, "src-tauri/gen/android/.gradle"),
    path.join(ROOT, "dist"),
    path.join(ROOT, "release"),
    path.join(os.homedir(), "Library/Caches/com.lumaread.app"),
    path.join(os.tmpdir(), "lumaread-update"),
    ...WANTED.map(([, name]) => path.join(DOWNLOADS, name)),
  ];
  for (const file of removed) fs.rmSync(file, { recursive: true, force: true });
  log("Removed build output, release copies, and the app download cache.");
}

if (finish) {
  const found = installers();
  if (!found.length) throw new Error("Nothing in release/ to publish. Build first, and leave release/ in place until the upload is confirmed.");
  writeVersionTxt(found);
  cleanup();
} else {
  assertClean();
  run("node", ["scripts/bump-version.mjs", kind], true);
  const next = version();
  commitAndPush(next);
  build(next);
  const found = installers();
  if (manual) {
    copyToDownloads(found);
    log("Replace those Drive files in place, then run pnpm release --finish. version.txt stays unchanged until then.");
  } else {
    run("node", ["scripts/publish-update.mjs"], true);
    cleanup();
  }
}
