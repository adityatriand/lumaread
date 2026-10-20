import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

// The dialog grants fs access to exactly the path the user picks; null when they cancel
async function pickPath(fileName: string) {
  const ext = fileName.split(".").pop()!;
  return save({ defaultPath: fileName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
}

export async function saveTextFile(fileName: string, contents: string): Promise<boolean> {
  const path = await pickPath(fileName);
  if (!path) return false;
  await writeTextFile(path, contents);
  return true;
}

export async function saveBinaryFile(fileName: string, bytes: Uint8Array): Promise<boolean> {
  const path = await pickPath(fileName);
  if (!path) return false;
  await writeFile(path, bytes);
  return true;
}
