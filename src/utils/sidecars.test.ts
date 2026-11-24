import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitFiles, refusedSidecars, walkSidecars } from "./sidecars";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function distFixture(): string {
  root = mkdtempSync(join(tmpdir(), "sidecars-"));
  const base = join(root, "dist", "climate");
  mkdirSync(join(base, "files"), { recursive: true });
  mkdirSync(join(base, "locales"), { recursive: true });
  writeFileSync(join(base, "files", "hero.png"), "png-bytes");
  writeFileSync(join(base, "files", ".DS_Store"), "junk");
  writeFileSync(join(base, "locales", "en.json"), '{"a":"A"}');
  writeFileSync(join(base, "locales", "fr.json"), '{"a":"B"}');
  return join(root, "dist");
}

describe("walkSidecars", () => {
  test("lists files and locales with digest and size, skipping dotfiles", () => {
    const found = walkSidecars(distFixture(), "climate");
    expect(found.map(({ data: _data, ...entry }) => entry)).toEqual([
      { path: "files/hero.png", sha256: sha("png-bytes"), bytes: 9 },
      { path: "locales/en.json", sha256: sha('{"a":"A"}'), bytes: 9 },
      { path: "locales/fr.json", sha256: sha('{"a":"B"}'), bytes: 9 },
    ]);
  });

  test("a widget without sidecars lists none", () => {
    expect(walkSidecars(distFixture(), "other")).toEqual([]);
  });

  test("names files the grammar refuses", () => {
    const dist = distFixture();
    writeFileSync(join(dist, "climate", "files", "HERO.PNG"), "x");
    expect(refusedSidecars(walkSidecars(dist, "climate"))).toEqual(["files/HERO.PNG (grammar)"]);
  });
});

describe("emitFiles", () => {
  test("copies src/<w>/files and leaves assets/ out", () => {
    root = mkdtempSync(join(tmpdir(), "emit-files-"));
    cpSync(join(import.meta.dir, "../../../widgets/src/lock"), join(root, "src", "lock"), {
      recursive: true,
    });
    emitFiles(root, "lock");
    expect(existsSync(join(root, "dist", "lock", "files"))).toBe(false);

    mkdirSync(join(root, "src", "lock", "files"));
    writeFileSync(join(root, "src", "lock", "files", "hero.webp"), "w");
    emitFiles(root, "lock");
    expect(walkSidecars(join(root, "dist"), "lock").map((f) => f.path)).toEqual([
      "files/hero.webp",
    ]);
  });
});
