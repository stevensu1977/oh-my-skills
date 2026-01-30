export type AgentType =
  | "all"
  | "claude"
  | "gemini"
  | "codex"
  | "opencode"
  | "kiro"
  | "antigravity"
  | "codebuddy"
  | "cursor"
  | "kimi"
  | "moltbot"
  | "qoder"
  | "qwen"
  | "zencoder";

export interface AgentInfo {
  id: AgentType;
  name: string;
  skills_path: string;
  has_mcp: boolean;
}

export interface SkillInfo {
  name: string;
  path: string;
  token_count: number | null;
}

export interface SkillMetadata {
  name: string;
  description: string | null;
  source: string | null;
  version: string | null;
  author: string | null;
  installed_at: string;
  updated_at: string;
}

export interface McpServerInfo {
  name: string;
  transport: "stdio" | "http";
  disabled: boolean | null;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  url: string | null;
  headers: Record<string, string> | null;
}

export interface AddMcpServerRequest {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface SearchSkill {
  name: string;
  slug: string;
  source: string;
  installs: number;
}

export interface FileItem {
  name: string;
  path: string;
  is_directory: boolean;
  size: number | null;
}

export type Tab = "skills" | "mcp";
