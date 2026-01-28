import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";
import type { AgentType, McpServerInfo, AddMcpServerRequest } from "../types";

interface Props {
  agent: AgentType;
  servers: McpServerInfo[];
  onRefresh: () => void;
  showToast: (message: string, type?: "success" | "error") => void;
}

export default function MCPPanel({ agent, servers, onRefresh, showToast }: Props) {
  const [showDialog, setShowDialog] = useState(false);
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [form, setForm] = useState({
    name: "",
    command: "",
    args: "",
    url: "",
    token: "",
  });
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

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setLoading(true);

    try {
      const request: AddMcpServerRequest = {
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

      await invoke("add_mcp_server", { agent, config: request });
      showToast(`Added ${form.name}`);
      setShowDialog(false);
      setForm({ name: "", command: "", args: "", url: "", token: "" });
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
        <div className="dialog-overlay" onClick={() => setShowDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Add MCP Server</h2>
              <button className="btn btn-icon" onClick={() => setShowDialog(false)}>x</button>
            </div>
            <div className="dialog-body">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="my-server"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
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
            </div>
            <div className="dialog-footer">
              <button className="btn" onClick={() => setShowDialog(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={loading || !form.name.trim()}>
                {loading ? "Adding..." : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
