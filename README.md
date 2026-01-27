# OhMySkills

A minimal desktop tool for managing Agent Skills and MCP (Model Context Protocol) Servers.

![Skills](./screenshots/Skills.png)
![Add Skills](./screenshots/Add-Skills.png)
![MCP Server](./screenshots/MCP-Server.png)
![Add MCP Server](./screenshots/Add-MCP-Server.png)

## Features

- **Skills Management**
  - Install skills from URL, local file, or GitHub repository
  - View SKILL.md content and token count
  - Delete installed skills
  
- **MCP Servers Management**
  - Add/remove STDIO and HTTP servers
  - Toggle server enabled/disabled state
  - View server configuration details

- **Multi-Agent Support**
  - Claude Code (`~/.claude/skills/`, `~/.claude.json`)
  - Gemini CLI (`~/.gemini/skills/`, `~/.gemini/settings.json`)
  - Codex CLI (`~/.codex/skills/`, `~/.codex/config.toml`)
  - Kiro CLI (`~/.kiro/skills/`, `~/.kiro/settings.json`)

- **System Tray**
  - Runs in background with tray icon
  - Quick access to settings and actions
  - Minimal resource usage

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust + Tauri 2.x
- **UI**: Dark theme, fixed 600x500 window

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)

### Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Usage

### Installing Skills

1. Click the "+" button in the Skills panel
2. Enter a skill source:
   - **URL**: Direct link to a `.zip` file or `SKILL.md`
   - **GitHub**: `github:owner/repo` or `https://github.com/owner/repo`
   - **Local**: Path to a local `.zip` file or directory

### Managing MCP Servers

1. Switch to the "MCP Servers" tab
2. Click "+" to add a new server
3. Choose transport type (STDIO or HTTP)
4. Fill in the required configuration

### Switching Agents

Use the dropdown in the header to switch between Claude, Gemini, Codex, and Kiro agents.

## Configuration Files

| Agent | Skills Directory | MCP Config |
|-------|-----------------|------------|
| Claude | `~/.claude/skills/` | `~/.claude.json` |
| Gemini | `~/.gemini/skills/` | `~/.gemini/settings.json` |
| Codex | `~/.codex/skills/` | `~/.codex/config.toml` |
| Kiro | `~/.kiro/skills/` | `~/.kiro/settings.json` |

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

