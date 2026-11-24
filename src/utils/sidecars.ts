import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { LOCALES } from "@glasshome/widget-contract";
import { sidecarPathRefusal } from "@glasshome/widget-contract/sidecars";
import { uploadToR2 } from "./hub-api";

export interface Sidecar {
  path: string;
  sha256: string;
  bytes: number;
  data: Buffer;
}

export type SidecarEntry = Pick<Sidecar, "path" | "sha256" | "bytes">;

const FOLDERS = ["files", "locales"] as const;

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  json: "application/json",
};

export function emitFiles(cwd: string, slug: string): void {
  const from = resolve(cwd, "src", slug, "files");
  const to = resolve(cwd, "dist", slug, "files");
  rmSync(to, { recursive: true, force: true });
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

export function walkSidecars(distDir: string, slug: string): Sidecar[] {
  const found: Sidecar[] = [];
  for (const folder of FOLDERS) {
    const dir = join(distDir, slug, folder);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name);
      if (name.startsWith(".") || !statSync(file).isFile()) continue;
      const data = readFileSync(file);
      found.push({
        path: `${folder}/${name}`,
        sha256: createHash("sha256").update(data).digest("hex"),
        bytes: data.byteLength,
        data,
      });
    }
  }
  return found;
}

export function refusedSidecars(sidecars: readonly Sidecar[]): string[] {
  return sidecars.flatMap((sidecar) => {
    const refusal = sidecarPathRefusal(sidecar.path, LOCALES);
    return refusal ? [`${sidecar.path} (${refusal})`] : [];
  });
}

export function entries(sidecars: readonly Sidecar[]): SidecarEntry[] {
  return sidecars.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
}

export async function uploadSidecars(
  uploads: Record<string, string> | undefined,
  sidecars: readonly Sidecar[],
): Promise<void> {
  for (const sidecar of sidecars) {
    const url = uploads?.[sidecar.path];
    if (!url) throw new Error(`the Hub gave no upload URL for ${sidecar.path}`);
    const extension = sidecar.path.slice(sidecar.path.lastIndexOf(".") + 1);
    await uploadToR2(url, sidecar.data, CONTENT_TYPES[extension]);
  }
}

export function missingSidecarSupport(
  sidecars: readonly Sidecar[],
  uploads: Record<string, string> | undefined,
): string | null {
  if (sidecars.length === 0 || uploads !== undefined) return null;
  return "this Hub does not accept widget images and locale catalogs yet, update the Hub first";
}
