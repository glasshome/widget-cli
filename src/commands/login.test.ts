import { describe, expect, test } from "bun:test";
import { authorizeUrl } from "./login";

describe("authorizeUrl", () => {
  test("asks for offline_access, so the login renews instead of ending after an hour", () => {
    const url = authorizeUrl("https://glasshome.app", { challenge: "c", state: "s" });
    expect(url.origin + url.pathname).toBe("https://glasshome.app/api/auth/oauth2/authorize");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
      "widgets:publish",
    ]);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:9274/callback");
  });
});
