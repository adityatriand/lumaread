// Bumps the app version in the three places a release reads:
//   package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
// Android's versionCode is derived by Tauri as major*1000000 + minor*1000 + patch,
// so a patch bump is enough for a phone to accept the new APK as an update.
// Run: node scripts/bump-version.mjs [patch|minor|major]
import fs from "node:fs";

const kind = process.argv[2] ?? "patch";
if (!["patch", "minor", "major"].includes(kind)) {
  console.error("usage: node scripts/bump-version.mjs [patch|minor|major]");
  process.exit(1);
}

const files = {
  pkg: "package.json",
  tauri: "src-tauri/tauri.conf.json",
  cargo: "src-tauri/Cargo.toml",
  lock: "src-tauri/Cargo.lock",
  readme: "README.md",
};

const pkg = JSON.parse(fs.readFileSync(files.pkg, "utf8"));
const tauri = JSON.parse(fs.readFileSync(files.tauri, "utf8"));
const cargo = fs.readFileSync(files.cargo, "utf8");
const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
if (pkg.version !== tauri.version || pkg.version !== cargoVersion) {
  throw new Error(`versions disagree: package.json ${pkg.version}, tauri.conf.json ${tauri.version}, Cargo.toml ${cargoVersion}`);
}

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!match) throw new Error(`version must be major.minor.patch, got ${pkg.version}`);
let major = Number(match[1]);
let minor = Number(match[2]);
let patch = Number(match[3]);
if (kind === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (kind === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}
const next = `${major}.${minor}.${patch}`;
const code = (version) => {
  const [a, b, c] = version.split(".").map(Number);
  return a * 1_000_000 + b * 1_000 + c;
};

const from = pkg.version;
pkg.version = next;
fs.writeFileSync(files.pkg, JSON.stringify(pkg, null, 2) + "\n");

const tauriText = fs.readFileSync(files.tauri, "utf8");
const tauriField = `"version": "${from}"`;
if (!tauriText.includes(tauriField)) throw new Error(`${files.tauri} has no ${tauriField}`);
fs.writeFileSync(files.tauri, tauriText.replace(tauriField, `"version": "${next}"`));

for (const file of [files.cargo, files.lock]) {
  const text = fs.readFileSync(file, "utf8");
  const block = `name = "lumaread"\nversion = "${from}"`;
  if (!text.includes(block)) throw new Error(`${file} has no lumaread version ${from}`);
  fs.writeFileSync(file, text.replace(block, `name = "lumaread"\nversion = "${next}"`));
}

const readme = fs.readFileSync(files.readme, "utf8");
const badge = `version-${from}-`;
if (readme.includes(badge)) fs.writeFileSync(files.readme, readme.replace(badge, `version-${next}-`));

console.log(`${from} → ${next} (${kind})`);
console.log(`Android versionCode ${code(from)} → ${code(next)}`);
