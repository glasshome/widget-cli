# @glasshome/widget-cli

CLI for creating and managing GlassHome widgets.

## Install

```bash
bun add -g @glasshome/widget-cli
```

## Quick Start

```bash
# Create a new widget project (interactive)
bunx @glasshome/widget-cli

# Or explicitly
bunx @glasshome/widget-cli create
```

## Commands

| Command | Description |
|---------|-------------|
| `create` | Create a new widget project (default when no project found) |
| `add` | Add a new widget to an existing project |
| `build` | Build all widgets |
| `connect <url>` | Connect to a running dashboard for live testing |
| `validate [name]` | Validate all widgets or a specific one |
| `publish` | Build and publish to GlassHome Hub |
| `login [hub-url]` | Authenticate with GlassHome Hub |
| `info [name]` | Show widget metadata and bundle info |
| `upgrade` | Upgrade @glasshome/widget-sdk to latest version |

Running `glasshome-widget` with no command inside a widget project shows help. Outside a widget project, it starts the create wizard.

## Documentation

Full docs at [glasshome.app/docs](https://glasshome.app/docs)

## License

MIT
