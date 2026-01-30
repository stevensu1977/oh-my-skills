# OhMySkills CLI + GUI 双模式设计方案

## 概述

参考 Ollama 的设计模式，将 OhMySkills 重构为同时支持 CLI 和 GUI 两种运行模式的工具。

### Ollama 模式参考

```bash
# CLI 模式
ollama list              # 列出模型
ollama pull llama3       # 下载模型
ollama run llama3        # 运行模型
ollama serve             # 启动服务端

# GUI 模式
ollama app               # 启动 GUI（macOS 菜单栏应用）
```

### OhMySkills 目标模式

```bash
# CLI 模式
omys list [--agent claude]           # 列出已安装的 skills
omys install <url|github:repo>       # 安装 skill
omys uninstall <skill-name>          # 卸载 skill
omys search <query>                  # 搜索 skills.sh
omys info <skill-name>               # 查看 skill 详情
omys mcp list                        # 列出 MCP servers
omys mcp add <config>                # 添加 MCP server
omys mcp remove <name>               # 移除 MCP server

# GUI 模式
omys                                 # 启动 GUI（默认）
omys gui                             # 显式启动 GUI
omys --no-gui                        # 强制 CLI 模式
```

---

## 架构设计

### 当前架构

```
┌─────────────────────────────────────┐
│           Tauri App                 │
│  ┌─────────────┐  ┌──────────────┐  │
│  │   React UI  │──│  Rust Core   │  │
│  │  (Frontend) │  │  (lib.rs)    │  │
│  └─────────────┘  └──────────────┘  │
└─────────────────────────────────────┘
```

### 目标架构

```
┌─────────────────────────────────────────────────────┐
│                    omys binary                        │
│  ┌────────────────────────────────────────────────┐ │
│  │              Core Library (lib.rs)              │ │
│  │  - Skills management                            │ │
│  │  - MCP server management                        │ │
│  │  - Agent detection                              │ │
│  └────────────────────────────────────────────────┘ │
│          ▲                        ▲                  │
│          │                        │                  │
│  ┌───────┴───────┐      ┌────────┴────────┐        │
│  │   CLI Module   │      │   GUI Module    │        │
│  │   (clap)       │      │   (Tauri)       │        │
│  └───────────────┘      └─────────────────┘        │
└─────────────────────────────────────────────────────┘
```

---

## 项目结构重构

### 目录结构

```
oh-my-skills/
├── Cargo.toml              # Workspace 配置
├── crates/
│   ├── omys-core/           # 核心库（无 UI 依赖）
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── agent.rs    # Agent 类型定义
│   │       ├── skill.rs    # Skills 管理
│   │       ├── mcp.rs      # MCP 管理
│   │       └── error.rs    # 错误类型
│   │
│   ├── omys-cli/            # CLI 模块
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs
│   │       └── commands/
│   │           ├── mod.rs
│   │           ├── list.rs
│   │           ├── install.rs
│   │           ├── search.rs
│   │           └── mcp.rs
│   │
│   └── omys-gui/            # GUI 模块 (Tauri)
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       ├── src/
│       │   ├── main.rs
│       │   └── lib.rs      # Tauri commands wrapper
│       └── ui/             # React frontend
│           ├── package.json
│           └── src/
│
├── src/                    # 统一入口
│   └── main.rs             # 根据参数选择 CLI/GUI
│
└── scripts/
    └── install.sh          # 安装脚本
```

---

## 核心模块设计 (omys-core)

### Cargo.toml

```toml
[package]
name = "omys-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["rt-multi-thread"] }
dirs = "5"
zip = "2"
base64 = "0.22"
chrono = "0.4"
thiserror = "1"
```

### API 设计

```rust
// omys-core/src/lib.rs
pub mod agent;
pub mod skill;
pub mod mcp;
pub mod error;

pub use agent::{AgentType, AgentInfo};
pub use skill::{SkillInfo, SkillMetadata, SkillManager};
pub use mcp::{McpServerInfo, McpManager};
pub use error::OmysError;

// 主要 API
impl SkillManager {
    pub fn new(agent: AgentType) -> Self;
    pub fn list(&self) -> Result<Vec<SkillInfo>>;
    pub fn get(&self, name: &str) -> Result<SkillInfo>;
    pub fn get_content(&self, name: &str) -> Result<String>;
    pub fn get_metadata(&self, name: &str) -> Result<SkillMetadata>;
    pub fn install_from_url(&self, url: &str) -> Result<String>;
    pub fn install_from_content(&self, content: &str, filename: &str) -> Result<String>;
    pub fn uninstall(&self, name: &str) -> Result<()>;
    pub fn open_folder(&self, name: &str) -> Result<()>;
}

impl McpManager {
    pub fn new(agent: AgentType) -> Self;
    pub fn list(&self) -> Result<Vec<McpServerInfo>>;
    pub fn add(&self, config: AddMcpServerRequest) -> Result<()>;
    pub fn remove(&self, name: &str) -> Result<()>;
    pub fn toggle(&self, name: &str, enabled: bool) -> Result<()>;
}

// 搜索 API
pub async fn search_skills(query: &str) -> Result<Vec<SearchSkill>>;
```

---

## CLI 模块设计 (omys-cli)

### 依赖

```toml
[package]
name = "omys-cli"
version = "0.1.0"
edition = "2021"

[dependencies]
omys-core = { path = "../omys-core" }
clap = { version = "4", features = ["derive"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
colored = "2"
tabled = "0.15"          # 表格输出
indicatif = "0.17"       # 进度条
```

### 命令结构

```rust
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "omys")]
#[command(about = "OhMySkills - Agent Skills & MCP Server Manager")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Target agent (claude, gemini, codex, etc.)
    #[arg(short, long, global = true, default_value = "claude")]
    agent: String,
}

#[derive(Subcommand)]
enum Commands {
    /// List installed skills
    List,

    /// Install a skill from URL or GitHub
    Install {
        /// URL, GitHub repo (github:user/repo), or local path
        source: String,
    },

    /// Uninstall a skill
    Uninstall {
        /// Skill name to uninstall
        name: String,
    },

    /// Search skills on skills.sh
    Search {
        /// Search query
        query: String,
    },

    /// Show skill details
    Info {
        /// Skill name
        name: String,
    },

    /// Open skill folder in file manager
    Open {
        /// Skill name
        name: String,
    },

    /// MCP server management
    Mcp {
        #[command(subcommand)]
        command: McpCommands,
    },

    /// Start GUI mode
    Gui,
}

#[derive(Subcommand)]
enum McpCommands {
    /// List MCP servers
    List,
    /// Add MCP server
    Add {
        /// Server name
        name: String,
        /// Transport type (stdio/http)
        #[arg(short, long, default_value = "stdio")]
        transport: String,
        /// Command (for stdio)
        #[arg(short, long)]
        command: Option<String>,
        /// Arguments
        #[arg(short, long)]
        args: Option<Vec<String>>,
        /// URL (for http)
        #[arg(short, long)]
        url: Option<String>,
    },
    /// Remove MCP server
    Remove {
        /// Server name
        name: String,
    },
    /// Enable/disable MCP server
    Toggle {
        /// Server name
        name: String,
        /// Enable or disable
        #[arg(long)]
        enable: bool,
    },
}
```

### 输出示例

```bash
$ omys list
┌──────────────┬────────────┬─────────────────────────────┐
│ Name         │ Tokens     │ Source                      │
├──────────────┼────────────┼─────────────────────────────┤
│ commit       │ 2.1k       │ github:anthropics/skills    │
│ docx         │ 8.5k       │ local                       │
│ frontend     │ 12.3k      │ github:example/frontend     │
└──────────────┴────────────┴─────────────────────────────┘

$ omys search "commit"
┌──────────────┬──────────┬─────────────────────────────┐
│ Name         │ Installs │ Source                      │
├──────────────┼──────────┼─────────────────────────────┤
│ commit-work  │ 1.9k     │ softaworks/agent-toolkit    │
│ git-commit   │ 316      │ github/awesome-copilot      │
└──────────────┴──────────┴─────────────────────────────┘

$ omys install github:anthropics/skills/commit
Installing commit from github:anthropics/skills...
✓ Installed successfully: commit (2.1k tokens)

$ omys info commit
Name:        commit
Description: Create well-formatted commits with conventional commit messages
Tokens:      2,134
Author:      anthropic
Source:      https://github.com/anthropics/skills
Installed:   2024-01-30

$ omys mcp list
┌──────────────┬───────────┬─────────────────────────────┐
│ Name         │ Transport │ Status                      │
├──────────────┼───────────┼─────────────────────────────┤
│ filesystem   │ stdio     │ enabled                     │
│ github       │ stdio     │ enabled                     │
│ slack        │ http      │ disabled                    │
└──────────────┴───────────┴─────────────────────────────┘
```

---

## GUI 模块设计 (omys-gui)

GUI 模块保持当前 Tauri 架构，但通过调用 omys-core 实现功能。

### Tauri Commands Wrapper

```rust
// omys-gui/src/lib.rs
use omys_core::{SkillManager, McpManager, AgentType};

#[tauri::command]
fn list_skills(agent: AgentType) -> Result<Vec<SkillInfo>, String> {
    let manager = SkillManager::new(agent);
    manager.list().map_err(|e| e.to_string())
}

#[tauri::command]
async fn install_skill_from_url(agent: AgentType, url: String) -> Result<String, String> {
    let manager = SkillManager::new(agent);
    manager.install_from_url(&url).map_err(|e| e.to_string())
}

// ... 其他命令包装
```

---

## 统一入口设计

### main.rs

```rust
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();

    // 判断运行模式
    let is_gui_mode = args.len() == 1  // 无参数默认 GUI
        || args.contains(&"gui".to_string())
        || args.contains(&"--gui".to_string());

    let is_cli_mode = args.contains(&"--no-gui".to_string())
        || args.iter().any(|a| {
            matches!(a.as_str(),
                "list" | "install" | "uninstall" | "search" |
                "info" | "open" | "mcp" | "help" | "--help" | "-h"
            )
        });

    if is_cli_mode && !is_gui_mode {
        omys_cli::run();
    } else {
        omys_gui::run();
    }
}
```

---

## 构建配置

### Workspace Cargo.toml

```toml
[workspace]
members = [
    "crates/omys-core",
    "crates/omys-cli",
    "crates/omys-gui",
]
resolver = "2"

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "MIT"
repository = "https://github.com/user/oh-my-skills"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["rt-multi-thread"] }

[profile.release]
strip = true
lto = true
codegen-units = 1
```

### 构建脚本

```bash
# scripts/build.sh

# 构建 CLI only (轻量级)
cargo build --release -p omys-cli

# 构建 GUI (包含前端)
cd crates/omys-gui && pnpm install && pnpm tauri build

# 构建统一二进制
cargo build --release
```

---

## 安装方式

### Homebrew (macOS)

```ruby
# Formula/omys.rb
class Omys < Formula
  desc "Agent Skills & MCP Server Manager"
  homepage "https://github.com/user/oh-my-skills"
  url "https://github.com/user/oh-my-skills/releases/download/v0.1.0/omys-darwin-arm64.tar.gz"

  def install
    bin.install "omys"
  end
end
```

### Shell 安装脚本

```bash
# 一键安装
curl -fsSL https://raw.githubusercontent.com/user/oh-my-skills/main/scripts/install.sh | bash
```

### Cargo 安装

```bash
# 仅安装 CLI
cargo install omys-cli

# 安装完整版（需要 Node.js）
cargo install omys
```

---

## 实施步骤

### Phase 1: 核心库提取
1. 从 `lib.rs` 提取纯业务逻辑到 `omys-core`
2. 移除 Tauri 相关依赖
3. 添加错误处理类型
4. 编写单元测试

### Phase 2: CLI 开发
1. 实现 clap 命令解析
2. 实现各子命令
3. 添加彩色输出和表格格式化
4. 编写集成测试

### Phase 3: GUI 重构
1. 修改 Tauri commands 调用 omys-core
2. 保持现有前端不变
3. 测试功能一致性

### Phase 4: 统一打包
1. 实现统一入口
2. 配置 CI/CD 构建流程
3. 发布多平台二进制

---

## 优势

1. **代码复用** - 核心逻辑只维护一份
2. **灵活部署** - 可以只安装 CLI（无 GUI 依赖）
3. **脚本友好** - CLI 可用于自动化脚本
4. **用户选择** - 用户可根据偏好选择使用方式
5. **跨平台** - CLI 更容易在服务器/容器中运行

## 劣势

1. **复杂度增加** - 需要维护多个 crate
2. **构建时间** - GUI 版本构建较慢
3. **二进制体积** - 统一版本体积较大
