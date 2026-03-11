interface PublishRequestParams {
  scope: string;
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  type: string;
  size: string;
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
    const text = await res.text();
    throw new Error(`Publish request failed (${res.status}): ${text}`);
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
    const text = await res.text();
    throw new Error(`Publish confirm failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<PublishConfirmResponse>;
}

export async function uploadToR2(
  uploadUrl: string,
  bundleBuffer: Buffer,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/javascript" },
    body: bundleBuffer,
  });

  if (!res.ok) {
    throw new Error(`R2 upload failed (${res.status}): ${await res.text()}`);
  }
}
