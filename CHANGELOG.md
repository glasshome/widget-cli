# Changelog

All notable changes to `@glasshome/widget-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.4](https://github.com/glasshome/widget-cli/compare/v0.15.3...v0.15.4) (2026-10-02)


### Bug Fixes

* **deps:** sync-layer 0.11.4 ([8c06989](https://github.com/glasshome/widget-cli/commit/8c069896d34fb1cd0e36343ea940a5e6b0a5ae2e))

## [0.15.3](https://github.com/glasshome/widget-cli/compare/v0.15.2...v0.15.3) (2026-10-02)


### Bug Fixes

* **deps:** sync-layer 0.11.3 ([405903a](https://github.com/glasshome/widget-cli/commit/405903a538fe882d0276592eacb6aed7c3618e96))

## [0.15.2](https://github.com/glasshome/widget-cli/compare/v0.15.1...v0.15.2) (2026-10-02)


### Bug Fixes

* **deps:** sync-layer 0.11.2 ([39e3611](https://github.com/glasshome/widget-cli/commit/39e3611115f0b8367eb33b53ec0931a68e03bb90))

## [0.15.1](https://github.com/glasshome/widget-cli/compare/v0.15.0...v0.15.1) (2026-10-02)


### Bug Fixes

* **deps:** sync-layer 0.11.1, widget-sdk 1.20.0 ([6745205](https://github.com/glasshome/widget-cli/commit/6745205a14e8796e9bd3afea7ddc89d5a1a2f9e0))

## [0.15.0](https://github.com/glasshome/widget-cli/compare/v0.14.6...v0.15.0) (2026-09-28)


### Features

* **add:** --name and --description skip the prompts; new widgets start as a sensor tile built from the SDK parts ([8f630fe](https://github.com/glasshome/widget-cli/commit/8f630fee3d7241a87afcd55f8ff0497aed5f738d))
* agent stubs, add flags, sensor-tile scaffold, preview fixes ([385a6cc](https://github.com/glasshome/widget-cli/commit/385a6ccf5b6f41563c07cf0d2a312aec7b0503a0))


### Bug Fixes

* **deps:** widget-sdk 1.19.0, which ships the widget guide ([8211b27](https://github.com/glasshome/widget-cli/commit/8211b27ba73e447b8151f6202474d674d116e3a6))
* **preview:** a crashing widget fails the render, ui previews without being a direct dependency, iconify-icon is declared ([674f9c9](https://github.com/glasshome/widget-cli/commit/674f9c92187ab729142346c4f73f39e8433e2cfe))

## [0.14.6](https://github.com/glasshome/widget-cli/compare/v0.14.5...v0.14.6) (2026-09-28)


### Bug Fixes

* **deps:** pin sync-layer 0.11.0 ([51bacf8](https://github.com/glasshome/widget-cli/commit/51bacf886db8b87d8c8f2509fa857794081059b5))

## [0.14.5](https://github.com/glasshome/widget-cli/compare/v0.14.4...v0.14.5) (2026-09-28)


### Bug Fixes

* **deps:** pin sync-layer 0.10.2 and widget-sdk 1.18.1 ([7f10e8b](https://github.com/glasshome/widget-cli/commit/7f10e8b32852f1782c3579b6888760aa11ed241b))

## [0.14.4](https://github.com/glasshome/widget-cli/compare/v0.14.3...v0.14.4) (2026-09-28)


### Miscellaneous Chores

* release 0.14.4 ([9257309](https://github.com/glasshome/widget-cli/commit/9257309e40a5a4e6f19e07e9fb13bee307cb4419))

## [0.14.3](https://github.com/glasshome/widget-cli/compare/v0.14.2...v0.14.3) (2026-09-27)


### Bug Fixes

* **deps:** sync-layer 0.10.1 ([#13](https://github.com/glasshome/widget-cli/issues/13)) ([b987256](https://github.com/glasshome/widget-cli/commit/b98725680c40122978161dfebc3072ae458c5af6))

## [0.14.2](https://github.com/glasshome/widget-cli/compare/v0.14.1...v0.14.2) (2026-09-27)


### Bug Fixes

* **connect:** refuse a device authorization answer with no device code ([5f33575](https://github.com/glasshome/widget-cli/commit/5f33575f69b2789f5e90429addaf87d9297315bf))
* **deps:** sync-layer 0.9.1, widget-sdk 1.18.0 ([449e281](https://github.com/glasshome/widget-cli/commit/449e2818d259644013e497d0e52483716c993ab1))
* **lint:** drop non-null assertions, any catches and Function eval ([eaa42df](https://github.com/glasshome/widget-cli/commit/eaa42df458dcc7ca0d6734eeff0ffe05d512e00e))

## [0.14.1](https://github.com/glasshome/widget-cli/compare/v0.14.0...v0.14.1) (2026-09-27)


### Bug Fixes

* **deps:** widget-sdk 1.17.1 ([02abb0d](https://github.com/glasshome/widget-cli/commit/02abb0d72c0cf407eaa908407717525929e72d4b))
* **preview:** the harness loads every font face before it reports ready, so a cold render never captures the fallback ([123f3c9](https://github.com/glasshome/widget-cli/commit/123f3c962cb36e58cddf719c7144e97354ce07a1))

## [0.14.0](https://github.com/glasshome/widget-cli/compare/v0.13.6...v0.14.0) (2026-09-27)


### Features

* **preview:** --sizes renders widgets at chosen sizes and states, with contact sheets ([c244501](https://github.com/glasshome/widget-cli/commit/c2445015f2af8fffdf2cc1e77de301b1917e6d10))


### Bug Fixes

* **deps:** widget-sdk 1.17.0, sync-layer 0.9.0, widget-contract 0.3.0 ([e1f5746](https://github.com/glasshome/widget-cli/commit/e1f5746047a234866c254476e9f4e82f0c69f880))
* **preview:** stills render with reduced motion, so mount transitions show their settled state ([bd760a9](https://github.com/glasshome/widget-cli/commit/bd760a9597f0a1b16fba09f749a9f8f2c0ee86bd))
* **preview:** the harness provides ui icons, so ui-drawn icons render ([d1d4f02](https://github.com/glasshome/widget-cli/commit/d1d4f02f63f39985968fd7b9c317e79529ecfd75))
* **preview:** widget roots stay closed as in dash; --click and --eval reach in through the kept root ([02f9879](https://github.com/glasshome/widget-cli/commit/02f9879891ff2a5d551fe5551dd5d73f97da1612))

## [0.13.6](https://github.com/glasshome/widget-cli/compare/v0.13.5...v0.13.6) (2026-09-22)


### Bug Fixes

* **deps:** the widget-sdk pin follows 1.16.0 ([00f463d](https://github.com/glasshome/widget-cli/commit/00f463d6692943e857372cd0495e5876268ac555))

## [0.13.5](https://github.com/glasshome/widget-cli/compare/v0.13.4...v0.13.5) (2026-09-21)


### Bug Fixes

* **deps:** the sync-layer pin follows 0.8.2 ([#7](https://github.com/glasshome/widget-cli/issues/7)) ([c91eb01](https://github.com/glasshome/widget-cli/commit/c91eb013dce4cddbc446db6057c2eb39025f42dc))

## [0.13.4](https://github.com/glasshome/widget-cli/compare/v0.13.3...v0.13.4) (2026-09-13)


### Bug Fixes

* **deps:** pin widget-sdk 1.15.1, and a cancel guard that narrows ([#5](https://github.com/glasshome/widget-cli/issues/5)) ([5633dc2](https://github.com/glasshome/widget-cli/commit/5633dc2c9f2e5b8ab173c9efa0bb0141a2cb5d63))

## [0.13.3](https://github.com/glasshome/widget-cli/compare/v0.13.2...v0.13.3) (2026-09-03)


### Bug Fixes

* **deps:** widget-contract 0.2.1, sync-layer 0.8.1, widget-sdk 1.14.3 ([23e3d9b](https://github.com/glasshome/widget-cli/commit/23e3d9b332ca3e4d30575a2c01a9421cfac64d8d))

## [0.13.2](https://github.com/glasshome/widget-cli/compare/v0.13.1...v0.13.2) (2026-08-30)


### Bug Fixes

* **deps:** @glasshome/widget-sdk 1.14.1 ([067a0bd](https://github.com/glasshome/widget-cli/commit/067a0bd5a1a44f691768a8d60b592fc7e39fac49))

## [0.13.1](https://github.com/glasshome/widget-cli/compare/v0.13.0...v0.13.1) (2026-08-30)


### Bug Fixes

* **deps:** @glasshome/widget-sdk 1.14.0 ([d62527d](https://github.com/glasshome/widget-cli/commit/d62527db7e7a6437206e03b4973a8075578bebe4))

## [0.11.2] - 2026-08-23

### Changed

- Builds on `@glasshome/widget-sdk` 1.11.1: widget CSS keeps
  `transparent` / `rgba()` instead of hex colors with alpha, which some
  embedded WebViews (Shelly Wall Display) drop.

## [0.11.1] - 2026-08-18

### Fixed

- `connect`, `build` and `preview` showed no progress while widgets were
  building: the spinner was silenced along with the build's own output, so the
  CLI printed its first line and then appeared to hang until the build was
  done.

### Changed

- `connect` now checks each rebuild in one reused worker instead of starting a
  fresh process per save, so saves are faster and no longer time out after the
  editor has been idle. Needs `@glasshome/widget-sdk` 1.11.0.

## [0.11.0] - 2026-08-16

### Changed

- `upgrade` in a standalone project now upgrades: it `bun add`s
  `@glasshome/widget-sdk` at `latest` (or `--to <version>`) into the section
  that already declares it, then syncs every manifest's `sdkVersion` and runs
  `validate`. It used to only sync manifests and print the manual steps.

## [0.10.6] - 2026-08-16

### Changed

- Bumped `@glasshome/widget-sdk` to 1.10.3, so `create` scaffolds against an SDK
  that builds on Windows and installs `@glasshome/ui` on its own.

## [0.10.4] - 2026-08-14

### Changed

- Bumped `@glasshome/widget-sdk` to 1.10.1 and `@glasshome/sync-layer` to 0.7.1
  (hygiene wave aligning published pins; no behavior changes).

## [0.10.3] - 2026-08-14

### Fixed

- `publish` sends the manifest written by the build it just ran, not the
  pre-build read, so bundle-owned keys no longer ship one publish behind.
- The preview harness claims the sync-layer host API at boot, keeping `preview`
  working now that sync-layer keeps demo data off the widget-reachable entry.

### Changed

- Bumped `@glasshome/widget-sdk` to 1.10.0 and `@glasshome/sync-layer` to 0.7.0.

## [0.10.2] - 2026-08-10

### Fixed

- `preview` renders at a real dashboard width instead of the breakpoint minimum,
  so a shot matches what the widget looks like on a dashboard.
- The preview shell has a surface to paint on, so transparent widgets no longer
  render against nothing.

### Changed

- Bumped `@glasshome/widget-sdk` to 1.9.2 and `@glasshome/sync-layer` to 0.6.0.

## [0.10.1] - 2026-08-08

### Changed

- Bumped `@glasshome/widget-sdk` to 1.9.0 and `@glasshome/sync-layer` to 0.5.0.

## [0.10.0] - 2026-08-08

### Added

- `build` and `publish` typecheck the project first and stop on a type error.
  Scaffolded projects built with a bare `vite build`, which strips types without
  checking them, so a widget could bundle and publish with its config type and
  its `configSchema` disagreeing. New projects also get a `typecheck` script and
  a `build` that runs `tsc --noEmit` first. A project with no `tsconfig.json`,
  or with no typescript installed, is not blocked: it warns that types were not
  checked and carries on.

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
- `preview` retries a shot that timed out once on a fresh browser before
  recording a miss. Slow renders under full-run load are flaky, not broken;
  the retry clears the intermittent single-shot failure.
- The `preview` run summary is readable: a healthy run no longer reads as a
  wall of errors.
- The `preview` harness no longer passes `isEditMode`, a field the SDK removed
  from `ReactiveWidgetContext`.

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
