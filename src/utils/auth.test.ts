import { describe, expect, test } from "bun:test";
import {
  type DeviceGrant,
  type DevicePollDeps,
  type DevicePollOutcome,
  deviceAuthorize,
  pollDeviceToken,
} from "./auth";

const API = "http://dash.test";

const grant: DeviceGrant = {
  deviceCode: "dev-123",
  userCode: "ABCD-EFGH",
  verificationUriComplete: `${API}/device?user_code=ABCD-EFGH`,
  expiresIn: 60,
  interval: 5,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function fakeDeps(responses: Array<Response | Error>) {
  let clock = 0;
  const sleeps: number[] = [];
  const bodies: unknown[] = [];
  const deps: DevicePollDeps = {
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    fetch: (url, init) => {
      expect(url).toBe(`${API}/api/auth/device/token`);
      bodies.push(typeof init.body === "string" ? JSON.parse(init.body) : init.body);
      const next = responses.shift();
      if (!next) throw new Error("unexpected poll");
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
  return { deps, sleeps, bodies };
}

describe("pollDeviceToken", () => {
  test("keeps polling while pending and returns the token once approved", async () => {
    const { deps, sleeps, bodies } = fakeDeps([
      json(400, { error: "authorization_pending" }),
      json(200, { access_token: "tok", expires_in: 3600 }),
    ]);
    const outcome = await pollDeviceToken(API, grant, deps);
    expect(outcome).toEqual({ kind: "authorized", token: "tok", expiresIn: 3600 });
    expect(sleeps).toEqual([5000, 5000]);
    expect(bodies[0]).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "dev-123",
      client_id: "glasshome-widget-cli",
    });
  });

  test("slow_down widens the interval, capped at 30s", async () => {
    const { deps, sleeps } = fakeDeps([
      ...Array.from({ length: 6 }, () => json(400, { error: "slow_down" })),
      json(200, { access_token: "tok" }),
    ]);
    const outcome = await pollDeviceToken(API, { ...grant, expiresIn: 600 }, deps);
    expect(outcome).toEqual({ kind: "authorized", token: "tok", expiresIn: 0 });
    expect(sleeps).toEqual([5000, 10000, 15000, 20000, 25000, 30000, 30000]);
  });

  test("maps terminal errors to outcomes", async () => {
    const cases: Array<[Response | Error, DevicePollOutcome]> = [
      [json(400, { error: "access_denied" }), { kind: "denied" }],
      [json(400, { error: "expired_token" }), { kind: "expired" }],
      [json(400, { error: "invalid_grant" }), { kind: "error", code: "invalid_grant" }],
      [json(500, {}), { kind: "error", code: 500 }],
      [json(200, {}), { kind: "missing_token" }],
      [new Error("ECONNREFUSED"), { kind: "failed", message: "ECONNREFUSED" }],
    ];
    for (const [response, expected] of cases) {
      const { deps } = fakeDeps([response]);
      expect(await pollDeviceToken(API, grant, deps)).toEqual(expected);
    }
  });

  test("times out when the code expires while still pending", async () => {
    const { deps, sleeps } = fakeDeps(
      Array.from({ length: 2 }, () => json(400, { error: "authorization_pending" })),
    );
    const outcome = await pollDeviceToken(API, { ...grant, expiresIn: 10 }, deps);
    expect(outcome).toEqual({ kind: "timeout" });
    expect(sleeps).toEqual([5000, 5000]);
  });
});

describe("deviceAuthorize", () => {
  test("builds the verification URL when the server omits the complete one", async () => {
    const result = await deviceAuthorize(API, () =>
      Promise.resolve(
        json(200, {
          device_code: "dev-1",
          user_code: "A B",
          verification_uri: `${API}/device`,
          expires_in: 900,
        }),
      ),
    );
    expect(result).toEqual({
      deviceCode: "dev-1",
      userCode: "A B",
      verificationUriComplete: `${API}/device?user_code=A%20B`,
      expiresIn: 900,
      interval: 5,
    });
  });

  test("throws on a non-OK response", async () => {
    const outcome = deviceAuthorize(API, () => Promise.resolve(json(503, {})));
    await expect(outcome).rejects.toThrow("HTTP 503");
  });

  test("throws when the server answers without a device code", async () => {
    const outcome = deviceAuthorize(API, () =>
      Promise.resolve(
        json(200, { user_code: "A", verification_uri: `${API}/device`, expires_in: 900 }),
      ),
    );
    await expect(outcome).rejects.toThrow("no device code");
  });
});
