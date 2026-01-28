import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown } from "lucide-react";
import type { Tab, AgentType, AgentInfo, SkillInfo, McpServerInfo } from "./types";
import SkillsPanel from "./components/SkillsPanel";
import MCPPanel from "./components/MCPPanel";

const AGENTS: { id: AgentType; name: string; icon: string }[] = [
  { id: "all", name: "All Agents", icon: "*" },
  { id: "claude", name: "Claude Code", icon: "C" },
  { id: "gemini", name: "Gemini CLI", icon: "G" },
  { id: "codex", name: "Codex CLI", icon: "X" },
  { id: "opencode", name: "OpenCode", icon: "O" },
  { id: "kiro", name: "Kiro CLI", icon: "K" },
  { id: "antigravity", name: "Antigravity", icon: "A" },
  { id: "codebuddy", name: "CodeBuddy", icon: "B" },
  { id: "cursor", name: "Cursor", icon: "U" },
  { id: "kimi", name: "Kimi CLI", icon: "I" },
  { id: "moltbot", name: "Moltbot", icon: "M" },
  { id: "qoder", name: "Qoder", icon: "D" },
  { id: "qwen", name: "Qwen Code", icon: "Q" },
  { id: "zencoder", name: "Zencoder", icon: "Z" },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("skills");
  const [agent, setAgent] = useState<AgentType>("claude");
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadAgentInfo = useCallback(async () => {
    try {
      const agents = await invoke<AgentInfo[]>("list_agents");
      const info = agents.find(a => a.id === agent);
      setAgentInfo(info || null);
    } catch (e) {
      console.error("Failed to load agent info:", e);
    }
  }, [agent]);

  const loadSkills = useCallback(async () => {
    try {
      const data = await invoke<SkillInfo[]>("list_skills", { agent });
      setSkills(data);
    } catch (e) {
      console.error("Failed to load skills:", e);
    }
  }, [agent]);

  const loadMcpServers = useCallback(async () => {
    try {
      const data = await invoke<McpServerInfo[]>("list_mcp_servers", { agent });
      setMcpServers(data);
    } catch (e) {
      console.error("Failed to load MCP servers:", e);
    }
  }, [agent]);

  useEffect(() => {
    loadAgentInfo();
    loadSkills();
    loadMcpServers();
  }, [loadAgentInfo, loadSkills, loadMcpServers]);

  const currentAgent = AGENTS.find(a => a.id === agent) || AGENTS[0];
  // "all" agent doesn't show MCP tab (too complex to manage MCP for all agents)
  const hasMcp = agent !== "all" && (agentInfo?.has_mcp ?? agent === "claude");

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="agent-selector" onClick={() => setShowAgentDropdown(!showAgentDropdown)}>
            <div className="agent-icon">{currentAgent.icon}</div>
            <span className="agent-name">{currentAgent.name}</span>
            <ChevronDown size={14} className={`agent-chevron ${showAgentDropdown ? "open" : ""}`} />

            {showAgentDropdown && (
              <div className="agent-dropdown">
                {AGENTS.map(a => (
                  <div
                    key={a.id}
                    className={`agent-option ${a.id === agent ? "active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAgent(a.id);
                      setShowAgentDropdown(false);
                    }}
                  >
                    <div className="agent-icon">{a.icon}</div>
                    <span>{a.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="tabs">
          <button
            className={`tab ${activeTab === "skills" ? "active" : ""}`}
            onClick={() => setActiveTab("skills")}
          >
            Skills ({skills.length})
          </button>
          {hasMcp && (
            <button
              className={`tab ${activeTab === "mcp" ? "active" : ""}`}
              onClick={() => setActiveTab("mcp")}
            >
              MCP Servers ({mcpServers.length})
            </button>
          )}
        </div>
      </header>

      <main className="content">
        {activeTab === "skills" ? (
          <SkillsPanel
            agent={agent}
            skills={skills}
            onRefresh={loadSkills}
            showToast={showToast}
          />
        ) : hasMcp ? (
          <MCPPanel
            agent={agent}
            servers={mcpServers}
            onRefresh={loadMcpServers}
            showToast={showToast}
          />
        ) : null}
      </main>

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
