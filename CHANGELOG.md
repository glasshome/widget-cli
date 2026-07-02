# Changelog

All notable changes to `@glasshome/widget-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
