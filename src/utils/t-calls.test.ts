import { describe, expect, test } from "bun:test";
import { findTCalls } from "./t-calls";

const IMPORT = 'import { useTranslation } from "@glasshome/widget-sdk"; ';
const find = (body: string) => findTCalls("w.tsx", IMPORT + body);

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

  test("a renamed SDK hook import and a namespace import are checked", () => {
    expect(
      findTCalls(
        "w.tsx",
        'import { useTranslation as useT } from "@glasshome/widget-sdk";\nconst { t } = useT();\nt("a");',
      ),
    ).toEqual([{ line: 3, key: "a" }]);
    expect(
      findTCalls(
        "w.tsx",
        'import * as sdk from "@glasshome/widget-sdk";\nconst { t } = sdk.useTranslation();\nt("a");\nsdk.useTranslation().t("b");',
      ),
    ).toEqual([
      { line: 3, key: "a" },
      { line: 4, key: "b" },
    ]);
  });

  test("a widget's own useTranslation hook is never checked", () => {
    expect(
      findTCalls(
        "w.tsx",
        'import { useTranslation } from "./i18n";\nconst { t } = useTranslation();\nt("a");\nuseTranslation().t("b");',
      ),
    ).toEqual([]);
    expect(
      findTCalls(
        "w.tsx",
        'function useTranslation() { return { t: (k: string) => k }; }\nconst { t } = useTranslation();\nt("a");',
      ),
    ).toEqual([]);
  });
});
