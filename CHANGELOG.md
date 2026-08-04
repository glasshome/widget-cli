# Changelog

All notable changes to `@glasshome/widget-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- New widgets no longer declare a stale `sdkVersion`. `create` and `add` wrote a
  hardcoded `^0.2.0` into every manifest while the project actually built
  against a 1.x SDK. Because a pre-1.0 range reads as "pre-capabilities" to the
  publish schema, those widgets were quietly excused from declaring
  `capabilities` at all. The range is now derived from the SDK the project has
  installed, and new widgets scaffold with `capabilities: []`.
- `validate` compares the manifest range against the SDK actually installed
  rather than the range declared in `package.json`. Comparing the two
  declarations only ever compared a claim with itself, which is why a manifest
  saying `^0.2.0` on a 1.7.0 build passed. A range that excludes the installed
  SDK is now an error, and it is checked during `publish` too, where it was
  previously skipped entirely.
- `upgrade` syncs manifest `sdkVersion` in standalone projects, not only inside
  the widget workspace. It is the command the new error points to, so it had to
  work outside a monorepo.

### Added

- `build` and `publish` typecheck the project first and stop on a type error.
  Scaffolded projects built with a bare `vite build`, which strips types without
  checking them, so a widget could bundle and publish with its config type and
  its `configSchema` disagreeing. New projects also get a `typecheck` script and
  a `build` that runs `tsc --noEmit` first. A project with no `tsconfig.json`,
  or with no typescript installed, is not blocked: it warns that types were not
  checked and carries on.

### Fixed

- `preview` retries a shot that timed out once on a fresh browser before
  recording a miss. Slow renders under full-run load are flaky, not broken;
  the retry clears the intermittent single-shot failure.
- The `preview` run summary is readable: a healthy run no longer reads as a
  wall of errors.

### Changed

- Bumped `@glasshome/widget-sdk` to 1.8.1.

## [0.9.0] - 2026-07-25

### Added

- `glasshome-widget preview` renders every `examples` entry from the widget
  manifest, light and dark, into `preview/`. Runs the same harness the hub's
  render worker uses (`@glasshome/widget-sdk/host` mount, frozen clock,
  offline icons, bundled fonts), so local output matches the published
  previews. Playwright is an optional peer: absent, the command prints the
  install line instead of failing the CLI.

### Removed

- The unused `dev-registry` command.

## [0.8.0] - 2026-07-05

### Added

- Automatic update detection. Every command now nudges when a newer
  `@glasshome/widget-cli` is published on npm. `build` and `validate` also warn
  when the project's `@glasshome/widget-sdk` is behind the latest release. The
  registry is queried at most once per day (cached in
  `~/.glasshome/update-check.json`); warm runs stay offline. Opt out with the
  `GLASSHOME_NO_UPDATE_NOTIFIER` or `CI` environment variables.
- `validate` warns when a widget's `manifest.json` `sdkVersion` range excludes
  the SDK version pinned in `package.json`, catching manifests that claim the
  wrong compatibility before publish.

### Fixed

- `login` now stores the hub-assigned username as your publish scope when the
  hub provides one, so the scope shown at login matches what `publish` actually
  uses. Older hubs that don't return a username fall back to the previous
  locally-derived scope.

## [0.7.0] - 2026-07-02

### Changed

- Cleaner terminal output across all commands. `info` now renders each widget as
  a boxed card with aligned fields; `create` next-steps and `connect` live-testing
  hints are grouped into boxes; section headers use consistent styling.
- Fixed duplicate final status line on `validate` (the result was printed twice).
- Build output no longer bleeds into the progress spinner during `build` and
  `connect` (the SDK's "[registry] Generated..." log was colliding with the
  spinner line).
- Consistent punctuation and phrasing in status messages.

### Fixed

- `login` spinner lifecycle: no longer double-stops or writes to a stopped
  spinner during the token-exchange phase.

## [0.6.0] - 2026-07-02

### Added

- `migrate config` command: rewrites a widget's raw-zod config to the SDK config
  API (`defineConfig` + `field.*`) via ts-morph. Assistive: unrecognized field
  patterns are left as raw zod and reported as manual TODOs. `--dry` previews,
  `--name <widget>` targets a single widget.
- `build`/`connect` now lint widget source for deprecated config usage (driven by
  the SDK deprecation registry) and direct `zod` imports, printing the removal
  timeline. Warning only, non-blocking.

### Changed

- Bumped `@glasshome/widget-sdk` dependency to `1.4.0`.

## [0.5.2] - 2026-06-14

### Changed

- Bumped `@glasshome/widget-sdk` dependency to `1.2.0`.

## [0.4.9] - 2026-05-17

### Changed

- Bumped `@glasshome/widget-sdk` dep range to `^0.4.0` for the channel-API release.
