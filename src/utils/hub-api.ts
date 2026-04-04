interface PublishScope {
  name: string;
  type: "personal" | "organization";
  displayName: string;
}

export async function fetchScopes(hubUrl: string, token: string): Promise<PublishScope[]> {
  const res = await fetch(`${hubUrl}/api/widgets/scopes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw Object.assign(new Error("Failed to fetch scopes"), { status: res.status });
  }
  const data = (await res.json()) as { scopes: PublishScope[] };
  return data.scopes;
}

import type { GridSize } from "@glasshome/widget-sdk";

interface PublishRequestParams {
  scope: string;
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  minSize: GridSize;
  maxSize: GridSize;
  sdkVersion: string;
  version: string;
  bundleSize: number;
  sha256Hash: string;
  manifestJson: string;
}

interface PublishRequestResponse {
  uploadUrl: string;
  cdnUrl: string;
  widgetId: string;
  versionId: string;
}

interface PublishConfirmResponse {
  success: boolean;
  bundleUrl: string;
}

export async function requestPublish(
  hubUrl: string,
  token: string,
  params: PublishRequestParams,
): Promise<PublishRequestResponse> {
  const res = await fetch(`${hubUrl}/api/widgets/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "request", ...params }),
  });

  if (res.status === 409) {
    const data = (await res.json()) as { error: string };
    throw Object.assign(new Error(data.error), { status: 409 });
  }

  if (!res.ok) {
    let detail: string;
    try {
      const body = await res.text();
      const json = JSON.parse(body);
      detail = json.error || json.message || body;
    } catch {
      detail = `HTTP ${res.status} ${res.statusText}`;
    }
    throw Object.assign(new Error(detail), { status: res.status });
  }

  return res.json() as Promise<PublishRequestResponse>;
}

export async function confirmPublish(
  hubUrl: string,
  token: string,
  versionId: string,
): Promise<PublishConfirmResponse> {
  const res = await fetch(`${hubUrl}/api/widgets/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "confirm", versionId }),
  });

  if (!res.ok) {
    let detail: string;
    try {
      const body = await res.text();
      const json = JSON.parse(body);
      detail = json.error || json.message || body;
    } catch {
      detail = `HTTP ${res.status} ${res.statusText}`;
    }
    throw Object.assign(new Error(detail), { status: res.status });
  }

  return res.json() as Promise<PublishConfirmResponse>;
}

export async function uploadToR2(uploadUrl: string, bundleBuffer: Uint8Array): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/javascript" },
    body: bundleBuffer as unknown as BodyInit,
  });

  if (!res.ok) {
    throw new Error(`R2 upload failed (${res.status}): ${await res.text()}`);
  }
}
