/**
 * Run `fn` with console logging swallowed. `buildWidgets()` (SDK) logs a
 * "[registry] Generated..." line mid-build; when the caller drives a clack
 * spinner that line lands on the spinner's line and garbles it.
 *
 * Only the console methods are silenced, never `process.stdout.write`: a clack
 * spinner renders its frames through that write, so overriding it left every
 * caller's spinner frozen for the whole build. Bun's console writes to fd 1
 * natively and bypasses a `process.stdout.write` override anyway, so the
 * console patch is the one that ever did the work. Stderr is left alone so real
 * warnings and errors still surface.
 */
export async function withQuietStdout<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalInfo = console.info;
  console.log = () => {};
  console.info = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
  }
}
