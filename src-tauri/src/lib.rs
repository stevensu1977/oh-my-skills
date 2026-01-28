use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentType {
    Claude,
    Gemini,
    Codex,
    Opencode,
    Kiro,
}

impl Default for AgentType {
    fn default() -> Self {
        AgentType::Claude
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub skills_path: String,
    pub has_mcp: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillInfo {
    pub name: String,
    pub path: String,
    pub token_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMetadata {
    pub name: String,
    pub source: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub installed_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServerInfo {
    pub name: String,
    pub transport: String,
    pub disabled: Option<bool>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AddMcpServerRequest {
    pub name: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
}

// ============================================================================
// Paths
// ============================================================================

fn get_skills_dir(agent: AgentType) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    match agent {
        AgentType::Claude => Ok(home.join(".claude").join("skills")),
        AgentType::Gemini => Ok(home.join(".gemini").join("skills")),
        AgentType::Codex => Ok(home.join(".codex").join("skills")),
        AgentType::Opencode => Ok(home.join(".opencode").join("skills")),
        AgentType::Kiro => Ok(home.join(".kiro").join("skills")),
    }
}

fn get_mcp_config_path(agent: AgentType) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    match agent {
        AgentType::Claude => Ok(home.join(".claude.json")),
        AgentType::Gemini => Ok(home.join(".gemini").join("settings.json")),
        AgentType::Codex => Ok(home.join(".codex").join("config.toml")),
        AgentType::Opencode => Ok(home.join(".opencode").join("config.json")),
        AgentType::Kiro => Ok(home.join(".kiro").join("settings.json")),
    }
}

fn agent_has_mcp_support(agent: AgentType) -> bool {
    matches!(agent, AgentType::Claude | AgentType::Gemini | AgentType::Opencode | AgentType::Kiro)
}

// ============================================================================
// Agent Commands
// ============================================================================

#[tauri::command]
fn list_agents() -> Result<Vec<AgentInfo>, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;

    let agents = vec![
        AgentInfo {
            id: "claude".to_string(),
            name: "Claude Code".to_string(),
            skills_path: home.join(".claude").join("skills").to_string_lossy().to_string(),
            has_mcp: true,
        },
        AgentInfo {
            id: "gemini".to_string(),
            name: "Gemini CLI".to_string(),
            skills_path: home.join(".gemini").join("skills").to_string_lossy().to_string(),
            has_mcp: true,
        },
        AgentInfo {
            id: "codex".to_string(),
            name: "Codex CLI".to_string(),
            skills_path: home.join(".codex").join("skills").to_string_lossy().to_string(),
            has_mcp: false,
        },
        AgentInfo {
            id: "opencode".to_string(),
            name: "OpenCode".to_string(),
            skills_path: home.join(".opencode").join("skills").to_string_lossy().to_string(),
            has_mcp: true,
        },
        AgentInfo {
            id: "kiro".to_string(),
            name: "Kiro CLI".to_string(),
            skills_path: home.join(".kiro").join("skills").to_string_lossy().to_string(),
            has_mcp: true,
        },
    ];

    Ok(agents)
}

// ============================================================================
// Skills Commands
// ============================================================================

#[tauri::command]
fn list_skills(agent: AgentType) -> Result<Vec<SkillInfo>, String> {
    let skills_dir = get_skills_dir(agent)?;

    if !skills_dir.exists() {
        return Ok(vec![]);
    }

    let mut skills = Vec::new();
    let entries = fs::read_dir(&skills_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            if name.starts_with('.') {
                continue;
            }

            let skill_md = find_skill_md(&path);
            let token_count = skill_md
                .as_ref()
                .and_then(|p| fs::metadata(p).ok().map(|m| m.len() / 4));

            skills.push(SkillInfo {
                name,
                path: path.to_string_lossy().to_string(),
                token_count,
            });
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

#[tauri::command]
fn get_skill_content(agent: AgentType, name: String) -> Result<String, String> {
    let skills_dir = get_skills_dir(agent)?;
    let skill_dir = skills_dir.join(&name);

    let skill_md =
        find_skill_md(&skill_dir).ok_or_else(|| format!("SKILL.md not found in {}", name))?;

    fs::read_to_string(skill_md).map_err(|e| e.to_string())
}

#[tauri::command]
async fn install_skill_from_url(agent: AgentType, url: String) -> Result<String, String> {
    let url = url.trim();

    // Check if it's a GitHub directory URL
    if url.contains("github.com") && url.contains("/tree/") {
        return install_from_github_dir(agent, url).await;
    }

    // Direct file URL
    let client = reqwest::Client::new();
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;

    let content = response.text().await.map_err(|e| e.to_string())?;
    let name = extract_skill_name(&content, url);

    let skills_dir = get_skills_dir(agent)?;
    fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;

    let skill_dir = skills_dir.join(sanitize_name(&name));
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;

    fs::write(skill_dir.join("SKILL.md"), &content).map_err(|e| e.to_string())?;

    save_metadata(&skill_dir, &name, Some(url.to_string()))?;

    Ok(format!("Installed: {}", name))
}

#[tauri::command]
fn install_skill_from_content(agent: AgentType, content: String, filename: String) -> Result<String, String> {
    let name = extract_skill_name(&content, &filename);

    let skills_dir = get_skills_dir(agent)?;
    fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;

    let skill_dir = skills_dir.join(sanitize_name(&name));
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;

    fs::write(skill_dir.join("SKILL.md"), &content).map_err(|e| e.to_string())?;

    save_metadata(&skill_dir, &name, None)?;

    Ok(format!("Installed: {}", name))
}

#[tauri::command]
fn install_skill_from_zip(agent: AgentType, zip_base64: String, source: String) -> Result<String, String> {
    let zip_data = STANDARD
        .decode(&zip_base64)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    let cursor = Cursor::new(&zip_data);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid ZIP: {}", e))?;

    // First pass: find SKILL.md and get prefix
    let mut skill_content = None;
    let mut skill_path_prefix = String::new();

    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| e.to_string())?;
        let file_name = file.name().to_string();
        drop(file); // Release borrow

        if file_name.contains("__MACOSX") {
            continue;
        }

        if file_name.to_lowercase().ends_with("skill.md") {
            // Re-open to read content
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let mut content = String::new();
            file.read_to_string(&mut content)
                .map_err(|e| e.to_string())?;

            if let Some(idx) = file_name.rfind('/') {
                skill_path_prefix = file_name[..=idx].to_string();
            }

            skill_content = Some(content);
            break;
        }
    }

    let content = skill_content.ok_or("No SKILL.md found in ZIP")?;
    let name = extract_skill_name(&content, &source);

    let skills_dir = get_skills_dir(agent)?;
    let skill_dir = skills_dir.join(sanitize_name(&name));
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;

    // Second pass: extract files
    let cursor2 = Cursor::new(&zip_data);
    let mut archive2 =
        zip::ZipArchive::new(cursor2).map_err(|e| format!("Invalid ZIP: {}", e))?;

    for i in 0..archive2.len() {
        let mut file = archive2.by_index(i).map_err(|e| e.to_string())?;
        let file_name = file.name().to_string();

        if file_name.contains("__MACOSX") || file.is_dir() {
            continue;
        }

        if !skill_path_prefix.is_empty() && !file_name.starts_with(&skill_path_prefix) {
            continue;
        }

        let relative_path = if skill_path_prefix.is_empty() {
            file_name.clone()
        } else {
            file_name
                .strip_prefix(&skill_path_prefix)
                .unwrap_or(&file_name)
                .to_string()
        };

        if relative_path.is_empty() {
            continue;
        }

        let out_path = skill_dir.join(&relative_path);

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).ok();
        }

        let mut file_content = Vec::new();
        file.read_to_end(&mut file_content)
            .map_err(|e| e.to_string())?;
        fs::write(&out_path, file_content).map_err(|e| e.to_string())?;
    }

    save_metadata(&skill_dir, &name, Some(source))?;

    Ok(format!("Installed: {}", name))
}

#[tauri::command]
fn delete_skill(agent: AgentType, name: String) -> Result<(), String> {
    let skills_dir = get_skills_dir(agent)?;
    let skill_dir = skills_dir.join(&name);

    if skill_dir.exists() {
        fs::remove_dir_all(&skill_dir).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn open_skill_folder(agent: AgentType, name: String) -> Result<(), String> {
    let skills_dir = get_skills_dir(agent)?;
    let skill_dir = skills_dir.join(&name);

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&skill_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&skill_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&skill_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ============================================================================
// MCP Server Commands
// ============================================================================

#[tauri::command]
fn list_mcp_servers(agent: AgentType) -> Result<Vec<McpServerInfo>, String> {
    if !agent_has_mcp_support(agent) {
        return Ok(vec![]);
    }
    let config_path = get_mcp_config_path(agent)?;

    if !config_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {}", e))?;

    let servers = config
        .get("mcpServers")
        .and_then(|s| s.as_object())
        .map(|obj| {
            obj.iter()
                .map(|(name, value)| parse_mcp_server(name, value))
                .collect()
        })
        .unwrap_or_default();

    Ok(servers)
}

#[tauri::command]
fn add_mcp_server(agent: AgentType, config: AddMcpServerRequest) -> Result<(), String> {
    if !agent_has_mcp_support(agent) {
        return Err("MCP is not supported for this agent".to_string());
    }
    let config_path = get_mcp_config_path(agent)?;

    let mut root: serde_json::Value = if config_path.exists() {
        let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };

    let mcp_servers = root
        .as_object_mut()
        .ok_or("Invalid config format")?
        .entry("mcpServers")
        .or_insert(serde_json::json!({}))
        .as_object_mut()
        .ok_or("Invalid mcpServers format")?;

    let mut server_config = serde_json::Map::new();

    if config.transport == "stdio" {
        server_config.insert("type".to_string(), serde_json::json!("stdio"));
        if let Some(cmd) = config.command {
            server_config.insert("command".to_string(), serde_json::json!(cmd));
        }
        if let Some(args) = config.args {
            server_config.insert("args".to_string(), serde_json::json!(args));
        }
        if let Some(env) = config.env {
            server_config.insert("env".to_string(), serde_json::json!(env));
        }
    } else {
        server_config.insert("type".to_string(), serde_json::json!("http"));
        if let Some(url) = config.url {
            server_config.insert("url".to_string(), serde_json::json!(url));
        }
        if let Some(headers) = config.headers {
            server_config.insert("headers".to_string(), serde_json::json!(headers));
        }
    }

    mcp_servers.insert(config.name, serde_json::Value::Object(server_config));

    // Ensure parent directory exists (for Gemini: ~/.gemini/)
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).ok();
    }

    let json_str = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&config_path, json_str).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn remove_mcp_server(agent: AgentType, name: String) -> Result<(), String> {
    if !agent_has_mcp_support(agent) {
        return Err("MCP is not supported for this agent".to_string());
    }
    let config_path = get_mcp_config_path(agent)?;

    if !config_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut root: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(mcp_servers) = root
        .get_mut("mcpServers")
        .and_then(|s| s.as_object_mut())
    {
        mcp_servers.remove(&name);
    }

    let json_str = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&config_path, json_str).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn toggle_mcp_server(agent: AgentType, name: String, disabled: bool) -> Result<(), String> {
    if !agent_has_mcp_support(agent) {
        return Err("MCP is not supported for this agent".to_string());
    }
    let config_path = get_mcp_config_path(agent)?;

    if !config_path.exists() {
        return Err("Config file not found".to_string());
    }

    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut root: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(server) = root
        .get_mut("mcpServers")
        .and_then(|s| s.get_mut(&name))
        .and_then(|s| s.as_object_mut())
    {
        if disabled {
            server.insert("disabled".to_string(), serde_json::json!(true));
        } else {
            server.remove("disabled");
        }
    }

    let json_str = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&config_path, json_str).map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================================
// Helper Functions
// ============================================================================

fn find_skill_md(dir: &PathBuf) -> Option<PathBuf> {
    let direct = dir.join("SKILL.md");
    if direct.exists() {
        return Some(direct);
    }

    let lowercase = dir.join("skill.md");
    if lowercase.exists() {
        return Some(lowercase);
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.to_lowercase() == "skill.md" {
                        return Some(path);
                    }
                }
            } else if path.is_dir() {
                if let Some(found) = find_skill_md(&path) {
                    return Some(found);
                }
            }
        }
    }

    None
}

fn extract_skill_name(content: &str, fallback: &str) -> String {
    if content.starts_with("---") {
        if let Some(end) = content[3..].find("---") {
            let frontmatter = &content[3..3 + end];
            for line in frontmatter.lines() {
                if line.starts_with("name:") {
                    let name = line[5..].trim().trim_matches('"').trim_matches('\'');
                    if !name.is_empty() {
                        return name.to_string();
                    }
                }
            }
        }
    }

    fallback
        .rsplit('/')
        .next()
        .unwrap_or(fallback)
        .trim_end_matches(".md")
        .trim_end_matches(".zip")
        .to_string()
}

fn sanitize_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();

    sanitized.to_lowercase().chars().take(50).collect()
}

fn save_metadata(skill_dir: &PathBuf, name: &str, source: Option<String>) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();

    let metadata = SkillMetadata {
        name: name.to_string(),
        source,
        version: None,
        author: None,
        installed_at: now.clone(),
        updated_at: now,
    };

    let json = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(skill_dir.join(".metadata.json"), json).map_err(|e| e.to_string())?;

    Ok(())
}

fn parse_mcp_server(name: &str, value: &serde_json::Value) -> McpServerInfo {
    let obj = value.as_object();

    let transport = if value.get("url").is_some() {
        "http"
    } else {
        "stdio"
    };

    McpServerInfo {
        name: name.to_string(),
        transport: transport.to_string(),
        disabled: value.get("disabled").and_then(|v| v.as_bool()),
        command: value
            .get("command")
            .and_then(|v| v.as_str())
            .map(String::from),
        args: value.get("args").and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
        }),
        env: obj.and_then(|o| o.get("env")).and_then(|v| {
            v.as_object().map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
        }),
        url: value.get("url").and_then(|v| v.as_str()).map(String::from),
        headers: obj.and_then(|o| o.get("headers")).and_then(|v| {
            v.as_object().map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
        }),
    }
}

async fn install_from_github_dir(agent: AgentType, url: &str) -> Result<String, String> {
    let parts: Vec<&str> = url
        .trim_start_matches("https://github.com/")
        .split('/')
        .collect();

    if parts.len() < 4 {
        return Err("Invalid GitHub URL format".to_string());
    }

    let owner = parts[0];
    let repo = parts[1];
    let branch = parts[3];
    let path = if parts.len() > 4 {
        parts[4..].join("/")
    } else {
        String::new()
    };

    let api_url = format!(
        "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
        owner, repo, path, branch
    );

    let client = reqwest::Client::builder()
        .user_agent("Oh-My-Skills/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let files = fetch_github_files(&client, &api_url).await?;

    if files.is_empty() {
        return Err("No files found in GitHub directory".to_string());
    }

    let skill_name = files
        .iter()
        .find(|(name, _)| name.to_lowercase() == "skill.md")
        .and_then(|(_, content)| {
            let name = extract_skill_name(content, "");
            if name.is_empty() {
                None
            } else {
                Some(name)
            }
        })
        .unwrap_or_else(|| path.rsplit('/').next().unwrap_or("skill").to_string());

    let skills_dir = get_skills_dir(agent)?;
    let skill_dir = skills_dir.join(sanitize_name(&skill_name));
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;

    for (file_path, content) in &files {
        let out_path = skill_dir.join(file_path);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&out_path, content).map_err(|e| e.to_string())?;
    }

    save_metadata(&skill_dir, &skill_name, Some(url.to_string()))?;

    Ok(format!("Installed: {}", skill_name))
}

async fn fetch_github_files(
    client: &reqwest::Client,
    api_url: &str,
) -> Result<Vec<(String, String)>, String> {
    let response = client.get(api_url).send().await.map_err(|e| e.to_string())?;

    let items: Vec<serde_json::Value> = response.json().await.map_err(|e| e.to_string())?;

    let mut files = Vec::new();

    for item in items {
        let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");

        if item_type == "file" {
            if let Some(download_url) = item.get("download_url").and_then(|v| v.as_str()) {
                let content = client
                    .get(download_url)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?
                    .text()
                    .await
                    .map_err(|e| e.to_string())?;

                files.push((name.to_string(), content));
            }
        } else if item_type == "dir" {
            if let Some(url) = item.get("url").and_then(|v| v.as_str()) {
                let sub_files = Box::pin(fetch_github_files(client, url)).await?;
                for (sub_name, content) in sub_files {
                    files.push((format!("{}/{}", name, sub_name), content));
                }
            }
        }
    }

    Ok(files)
}

// ============================================================================
// App Entry
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            list_agents,
            list_skills,
            get_skill_content,
            install_skill_from_url,
            install_skill_from_content,
            install_skill_from_zip,
            delete_skill,
            open_skill_folder,
            list_mcp_servers,
            add_mcp_server,
            remove_mcp_server,
            toggle_mcp_server,
        ])
        .setup(|app| {
            use tauri::menu::PredefinedMenuItem;

            // Create tray menu items
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let guide_item = MenuItem::with_id(app, "guide", "User Guide", true, None::<&str>)?;
            let version_item = MenuItem::with_id(app, "version", "Version: 0.1.0", false, None::<&str>)?;
            let update_item = MenuItem::with_id(app, "update", "Check for updates...", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit OhMySkills", true, None::<&str>)?;

            // macOS requires menu items to be in a Submenu
            let submenu = Submenu::with_items(app, "OhMySkills", true, &[
                &settings_item,
                &guide_item,
                &PredefinedMenuItem::separator(app)?,
                &version_item,
                &update_item,
                &PredefinedMenuItem::separator(app)?,
                &quit_item,
            ])?;

            let tray_menu = Menu::with_items(app, &[&submenu])?;

            // Create tray icon with menu
            let tray = TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/tray-icon.png"))
                .icon_as_template(true)
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => {
                        #[cfg(target_os = "macos")]
                        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("show-settings", ());
                        }
                    }
                    "guide" => {
                        let _ = open::that("https://github.com/anthropics/claude-code");
                    }
                    "update" => {
                        // TODO: Implement update check logic
                        let _ = open::that("https://github.com/anthropics/claude-code/releases");
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Keep tray icon alive by storing it in app state
            app.manage(tray);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide window and remove from Dock
                let _ = window.hide();
                #[cfg(target_os = "macos")]
                {
                    let app = window.app_handle();
                    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
