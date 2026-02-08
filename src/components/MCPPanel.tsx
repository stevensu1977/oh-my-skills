import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2, Plus, X, Pencil } from "lucide-react";
import type { AgentType, McpServerInfo, AddMcpServerRequest } from "../types";

interface Props {
  agent: AgentType;
  servers: McpServerInfo[];
  onRefresh: () => void;
  showToast: (message: string, type?: "success" | "error") => void;
}

interface EnvEntry {
  key: string;
  value: string;
}

export default function MCPPanel({ agent, servers, onRefresh, showToast }: Props) {
  const [showDialog, setShowDialog] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerInfo | null>(null);
  const [inputMode, setInputMode] = useState<"form" | "json">("form");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [form, setForm] = useState({
    name: "",
    command: "",
    args: "",
    url: "",
    token: "",
  });
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([]);
  const [jsonInput, setJsonInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleToggle = async (name: string, disabled: boolean | null) => {
    try {
      await invoke("toggle_mcp_server", { agent, name, disabled: !disabled });
      onRefresh();
    } catch (e) {
      showToast(`${e}`, "error");
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete MCP server "${name}"?`)) return;
    try {
      await invoke("remove_mcp_server", { agent, name });
      showToast(`Deleted ${name}`);
      onRefresh();
    } catch (e) {
      showToast(`${e}`, "error");
    }
  };

  const addEnvEntry = () => {
    setEnvEntries([...envEntries, { key: "", value: "" }]);
  };

  const removeEnvEntry = (index: number) => {
    setEnvEntries(envEntries.filter((_, i) => i !== index));
  };

  const updateEnvEntry = (index: number, field: "key" | "value", value: string) => {
    const updated = [...envEntries];
    updated[index][field] = value;
    setEnvEntries(updated);
  };

  const resetForm = () => {
    setForm({ name: "", command: "", args: "", url: "", token: "" });
    setEnvEntries([]);
    setJsonInput("");
    setInputMode("form");
    setTransport("stdio");
    setEditingServer(null);
  };

  const handleEdit = (server: McpServerInfo) => {
    setEditingServer(server);
    setInputMode("form");
    setTransport(server.transport);

    if (server.transport === "stdio") {
      setForm({
        name: server.name,
        command: server.command || "",
        args: server.args?.join(" ") || "",
        url: "",
        token: "",
      });
      // Populate environment variables
      if (server.env) {
        setEnvEntries(
          Object.entries(server.env).map(([key, value]) => ({ key, value }))
        );
      } else {
        setEnvEntries([]);
      }
    } else {
      // Extract token from Authorization header if present
      const authHeader = server.headers?.["Authorization"] || "";
      const token = authHeader.replace("Bearer ", "");
      setForm({
        name: server.name,
        command: "",
        args: "",
        url: server.url || "",
        token: token,
      });
      setEnvEntries([]);
    }

    // Generate JSON for JSON mode
    const serverConfig: Record<string, unknown> = {};
    if (server.transport === "stdio") {
      if (server.command) serverConfig.command = server.command;
      if (server.args && server.args.length > 0) serverConfig.args = server.args;
      if (server.env && Object.keys(server.env).length > 0) serverConfig.env = server.env;
    } else {
      if (server.url) serverConfig.url = server.url;
      if (server.headers && Object.keys(server.headers).length > 0) serverConfig.headers = server.headers;
    }
    const jsonConfig = {
      mcpServers: {
        [server.name]: serverConfig
      }
    };
    setJsonInput(JSON.stringify(jsonConfig, null, 2));

    setShowDialog(true);
  };

  const handleAdd = async () => {
    setLoading(true);

    try {
      let request: AddMcpServerRequest;

      if (inputMode === "json") {
        // JSON mode: parse and validate the JSON input
        if (!jsonInput.trim()) {
          showToast("JSON configuration is required", "error");
          return;
        }

        try {
          const parsed = JSON.parse(jsonInput.trim());

          // Support both formats: full mcpServers object or single server config
          let serverName: string;
          let serverConfig: Record<string, unknown>;

          if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
            // Format: { "mcpServers": { "server-name": { ... } } }
            const servers = Object.entries(parsed.mcpServers);
            if (servers.length === 0) {
              showToast("No server found in mcpServers", "error");
              return;
            }
            if (servers.length > 1) {
              showToast("Please add one server at a time", "error");
              return;
            }
            [serverName, serverConfig] = servers[0] as [string, Record<string, unknown>];
          } else if (parsed.name || parsed.command || parsed.url) {
            // Format: { "name": "...", "command": "...", ... }
            serverName = parsed.name || "unnamed-server";
            serverConfig = parsed;
          } else {
            // Format: { "server-name": { ... } }
            const entries = Object.entries(parsed);
            if (entries.length === 0) {
              showToast("Invalid JSON format", "error");
              return;
            }
            [serverName, serverConfig] = entries[0] as [string, Record<string, unknown>];
          }

          // Determine transport type
          const hasCommand = "command" in serverConfig;
          const hasUrl = "url" in serverConfig;

          request = {
            name: serverName,
            transport: hasUrl && !hasCommand ? "http" : "stdio",
          };

          if (request.transport === "stdio") {
            if (!serverConfig.command) {
              showToast("Command is required for stdio transport", "error");
              return;
            }
            request.command = serverConfig.command as string;
            if (serverConfig.args) {
              request.args = serverConfig.args as string[];
            }
            if (serverConfig.env && typeof serverConfig.env === "object") {
              request.env = serverConfig.env as Record<string, string>;
            }
          } else {
            if (!serverConfig.url) {
              showToast("URL is required for http transport", "error");
              return;
            }
            request.url = serverConfig.url as string;
            if (serverConfig.headers && typeof serverConfig.headers === "object") {
              request.headers = serverConfig.headers as Record<string, string>;
            }
          }
        } catch {
          showToast("Invalid JSON format", "error");
          return;
        }
      } else {
        // Form mode
        if (!form.name.trim()) {
          showToast("Name is required", "error");
          return;
        }

        request = {
          name: form.name.trim(),
          transport,
        };

        if (transport === "stdio") {
          if (!form.command.trim()) {
            showToast("Command is required", "error");
            return;
          }
          request.command = form.command.trim();
          if (form.args.trim()) {
            request.args = form.args.split(/\s+/).filter(Boolean);
          }
          // Add env variables
          const env: Record<string, string> = {};
          for (const entry of envEntries) {
            if (entry.key.trim()) {
              env[entry.key.trim()] = entry.value;
            }
          }
          if (Object.keys(env).length > 0) {
            request.env = env;
          }
        } else {
          if (!form.url.trim()) {
            showToast("URL is required", "error");
            return;
          }
          request.url = form.url.trim();
          if (form.token.trim()) {
            request.headers = { Authorization: `Bearer ${form.token.trim()}` };
          }
        }
      }

      await invoke("add_mcp_server", { agent, config: request });
      showToast(editingServer ? `Updated ${request.name}` : `Added ${request.name}`);
      setShowDialog(false);
      resetForm();
      onRefresh();
    } catch (e) {
      showToast(`${e}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="list">
        {servers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">+</div>
            <p>No MCP servers configured</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowDialog(true)}>
              Add MCP Server
            </button>
          </div>
        ) : (
          servers.map((server) => (
            <div key={server.name} className="list-item">
              <div className="list-item-info">
                <div className="list-item-name">
                  {server.name}
                  <span className={`badge badge-${server.transport}`}>{server.transport}</span>
                </div>
                <div className="list-item-meta">
                  {server.transport === "stdio"
                    ? `${server.command} ${server.args?.join(" ") || ""}`
                    : server.url}
                </div>
              </div>
              <div className="list-item-actions">
                <div
                  className={`toggle ${!server.disabled ? "active" : ""}`}
                  onClick={() => handleToggle(server.name, server.disabled)}
                  title={server.disabled ? "Enable" : "Disable"}
                />
                <button className="btn btn-icon" onClick={() => handleEdit(server)} title="Edit">
                  <Pencil size={16} />
                </button>
                <button className="btn btn-icon btn-danger" onClick={() => handleDelete(server.name)} title="Delete">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {servers.length > 0 && (
        <div className="footer">
          <button className="btn btn-primary" onClick={() => setShowDialog(true)}>
            + Add MCP Server
          </button>
        </div>
      )}

      {showDialog && (
        <div className="dialog-overlay" onClick={() => { setShowDialog(false); resetForm(); }}>
          <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>{editingServer ? "Edit MCP Server" : "Add MCP Server"}</h2>
              <button className="btn btn-icon" onClick={() => { setShowDialog(false); resetForm(); }}>x</button>
            </div>
            <div className="dialog-body">
              {/* Mode Tabs */}
              <div className="tabs">
                <button
                  className={`tab ${inputMode === "form" ? "active" : ""}`}
                  onClick={() => setInputMode("form")}
                >
                  Form
                </button>
                <button
                  className={`tab ${inputMode === "json" ? "active" : ""}`}
                  onClick={() => setInputMode("json")}
                >
                  JSON
                </button>
              </div>

              {inputMode === "form" ? (
                <>
                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="my-server"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      disabled={!!editingServer}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Transport</label>
                    <select
                      className="form-input form-select"
                      value={transport}
                      onChange={(e) => setTransport(e.target.value as "stdio" | "http")}
                    >
                      <option value="stdio">STDIO (Local command)</option>
                      <option value="http">HTTP (Remote URL)</option>
                    </select>
                  </div>

                  {transport === "stdio" ? (
                    <>
                      <div className="form-group">
                        <label className="form-label">Command</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="npx"
                          value={form.command}
                          onChange={(e) => setForm({ ...form, command: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Arguments (space separated)</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="-y @modelcontextprotocol/server-filesystem /path"
                          value={form.args}
                          onChange={(e) => setForm({ ...form, args: e.target.value })}
                        />
                      </div>
                      {/* Environment Variables */}
                      <div className="form-group">
                        <div className="form-label-row">
                          <label className="form-label">Environment Variables</label>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={addEnvEntry}
                          >
                            <Plus size={14} /> Add
                          </button>
                        </div>
                        {envEntries.length === 0 ? (
                          <div className="env-empty">No environment variables</div>
                        ) : (
                          <div className="env-list">
                            {envEntries.map((entry, index) => (
                              <div key={index} className="env-row">
                                <input
                                  type="text"
                                  className="form-input env-key"
                                  placeholder="KEY"
                                  value={entry.key}
                                  onChange={(e) => updateEnvEntry(index, "key", e.target.value)}
                                />
                                <span className="env-separator">=</span>
                                <input
                                  type="text"
                                  className="form-input env-value"
                                  placeholder="value"
                                  value={entry.value}
                                  onChange={(e) => updateEnvEntry(index, "value", e.target.value)}
                                />
                                <button
                                  type="button"
                                  className="btn btn-icon btn-danger"
                                  onClick={() => removeEnvEntry(index)}
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="form-group">
                        <label className="form-label">URL</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="http://localhost:8080/mcp"
                          value={form.url}
                          onChange={(e) => setForm({ ...form, url: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Bearer Token (optional)</label>
                        <input
                          type="password"
                          className="form-input"
                          placeholder="your-api-token"
                          value={form.token}
                          onChange={(e) => setForm({ ...form, token: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                </>
              ) : (
                /* JSON Mode */
                <div className="form-group">
                  <label className="form-label">JSON Configuration</label>
                  <textarea
                    className="form-input form-textarea"
                    placeholder={`{
  "mcpServers": {
    "my-server": {
      "command": "uvx",
      "args": ["package-name"],
      "env": {
        "API_KEY": "your-key"
      }
    }
  }
}`}
                    value={jsonInput}
                    onChange={(e) => setJsonInput(e.target.value)}
                    rows={12}
                  />
                  <div className="form-hint">
                    Paste JSON config from MCP server documentation. Supports multiple formats.
                  </div>
                </div>
              )}
            </div>
            <div className="dialog-footer">
              <button className="btn" onClick={() => { setShowDialog(false); resetForm(); }}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={loading || (inputMode === "form" && !form.name.trim()) || (inputMode === "json" && !jsonInput.trim())}
              >
                {loading ? (editingServer ? "Saving..." : "Adding...") : (editingServer ? "Save" : "Add")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
