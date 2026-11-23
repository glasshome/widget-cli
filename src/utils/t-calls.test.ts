import { describe, expect, test } from "bun:test";
import { findTCalls } from "./t-calls";

const find = (body: string) => findTCalls("w.tsx", body);

describe("findTCalls", () => {
  test("a literal key from a useTranslation destructure", () => {
    expect(find('const { t } = useTranslation();\nt("a.b");')).toEqual([{ line: 2, key: "a.b" }]);
  });

  test("a renamed destructure", () => {
    expect(find('const { t: tr } = useTranslation();\ntr("a");')).toEqual([{ line: 2, key: "a" }]);
  });

  test("the SDK's top-level t import, renamed or not", () => {
    expect(find('import { t } from "@glasshome/widget-sdk";\nt("a");')).toEqual([
      { line: 2, key: "a" },
    ]);
    expect(find('import { t as tr } from "@glasshome/widget-sdk";\ntr("a");')).toEqual([
      { line: 2, key: "a" },
    ]);
  });

  test("a translator object and a direct call", () => {
    expect(find('const i = useTranslation();\ni.t("a");\nuseTranslation().t("b");')).toEqual([
      { line: 2, key: "a" },
      { line: 3, key: "b" },
    ]);
  });

  test("a substituted template, a concatenation and a variable carry no key", () => {
    const calls = find(
      'const { t } = useTranslation();\nt(`a.${x}`);\nt("a" + b);\nt(someVar);\nt(`plain`);',
    );
    expect(calls).toEqual([
      { line: 2, key: null },
      { line: 3, key: null },
      { line: 4, key: null },
      { line: 5, key: "plain" },
    ]);
  });

  test("an unrelated local t is ignored", () => {
    expect(find("const t = (n: number) => n;\nt(0.5);\nx.t(1);")).toEqual([]);
  });
});
