/**
 * Run `fn` with stdout writes swallowed. `buildWidgets()` (SDK) console.logs a
 * "[registry] Generated..." line mid-build; when the caller drives a clack
 * spinner that raw write lands on the spinner's line and garbles it. Stderr is
 * left alone so real warnings/errors still surface.
 */
export async function withQuietStdout<T>(fn: () => Promise<T>): Promise<T> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalLog = console.log;
  // Bun's console.log writes to fd 1 natively and bypasses a process.stdout.write
  // override, so both paths are silenced.
  process.stdout.write = (() => true) as typeof process.stdout.write;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }
}
