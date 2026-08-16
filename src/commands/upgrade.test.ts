import { describe, expect, test } from "bun:test";
import { sdkDependencySection } from "./upgrade";

describe("sdkDependencySection", () => {
  test("finds the SDK in whichever section declares it", () => {
    expect(sdkDependencySection({ peerDependencies: { "@glasshome/widget-sdk": "^1.10.2" } })).toBe(
      "peerDependencies",
    );
    expect(sdkDependencySection({ devDependencies: { "@glasshome/widget-sdk": "^1.10.2" } })).toBe(
      "devDependencies",
    );
    expect(sdkDependencySection({ dependencies: { "@glasshome/widget-sdk": "^1.10.2" } })).toBe(
      "dependencies",
    );
  });

  test("returns null when the SDK is not declared", () => {
    expect(sdkDependencySection({ dependencies: { zod: "^4" } })).toBeNull();
  });
});
