export type ScalarConfig = Record<string, string | number | boolean>;

/** A `--config` the stage can carry: a JSON object of strings, numbers and booleans. */
export function parseScalarConfig(value: string): ScalarConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`--config must be a JSON object (got ${value})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`--config must be a JSON object (got ${value})`);
  for (const [key, field] of Object.entries(parsed)) {
    if (!["string", "number", "boolean"].includes(typeof field))
      throw new Error(
        `--config "${key}": previews carry only text, number and true/false values, no lists or objects`,
      );
  }
  return parsed as ScalarConfig;
}
