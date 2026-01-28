import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Trash2 } from "lucide-react";
import type { AgentType, SkillInfo } from "../types";

interface Props {
  agent: AgentType;
  skills: SkillInfo[];
  onRefresh: () => void;
  showToast: (message: string, type?: "success" | "error") => void;
}

export default function SkillsPanel({ agent, skills, onRefresh, showToast }: Props) {
  const [showDialog, setShowDialog] = useState(false);
  const [installMode, setInstallMode] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatTokens = (count: number | null) => {
    if (!count) return "";
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k tokens`;
    return `${count} tokens`;
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await invoke("delete_skill", { agent, name: deleteTarget });
      showToast(`Deleted ${deleteTarget}`);
      onRefresh();
    } catch (e) {
      showToast(`Failed to delete: ${e}`, "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleOpenFolder = async (name: string) => {
    try {
      await invoke("open_skill_folder", { agent, name });
    } catch (e) {
      showToast(`Failed to open folder: ${e}`, "error");
    }
  };

  const handleInstallFromUrl = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const result = await invoke<string>("install_skill_from_url", { agent, url: url.trim() });
      showToast(result);
      setShowDialog(false);
      setUrl("");
      onRefresh();
    } catch (e) {
      showToast(`${e}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    setLoading(true);
    try {
      const content = await file.text();
      const isZip = file.name.endsWith(".zip");

      if (isZip) {
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        await invoke("install_skill_from_zip", { agent, zipBase64: base64, source: file.name });
      } else {
        await invoke("install_skill_from_content", {
          agent,
          content,
          filename: file.name
        });
      }
      showToast(`Installed from ${file.name}`);
      setShowDialog(false);
      onRefresh();
    } catch (e) {
      showToast(`${e}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".md") || file.name.endsWith(".zip"))) {
      handleFileSelect(file);
    } else {
      showToast("Only .md or .zip files allowed", "error");
    }
  };

  return (
    <>
      <div className="list">
        {skills.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">+</div>
            <p>No skills installed</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowDialog(true)}>
              Add Skill
            </button>
          </div>
        ) : (
          skills.map((skill) => (
            <div key={skill.name} className="list-item">
              <div className="list-item-info">
                <div className="list-item-name">{skill.name}</div>
                <div className="list-item-meta">{formatTokens(skill.token_count)}</div>
              </div>
              <div className="list-item-actions">
                <button className="btn btn-icon" onClick={() => handleOpenFolder(skill.name)} title="Open folder">
                  <FolderOpen size={16} />
                </button>
                <button className="btn btn-icon btn-danger" onClick={() => setDeleteTarget(skill.name)} title="Delete">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {skills.length > 0 && (
        <div className="footer">
          <button className="btn btn-primary" onClick={() => setShowDialog(true)}>
            + Add Skill
          </button>
        </div>
      )}

      {showDialog && (
        <div className="dialog-overlay" onClick={() => setShowDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Add Skill</h2>
              <button className="btn btn-icon" onClick={() => setShowDialog(false)}>x</button>
            </div>
            <div className="dialog-body">
              <div className="tab-buttons">
                <button
                  className={`tab-btn ${installMode === "url" ? "active" : ""}`}
                  onClick={() => setInstallMode("url")}
                >
                  From URL
                </button>
                <button
                  className={`tab-btn ${installMode === "file" ? "active" : ""}`}
                  onClick={() => setInstallMode("file")}
                >
                  From File
                </button>
              </div>

              {installMode === "url" ? (
                <div className="form-group">
                  <label className="form-label">Skill URL or GitHub directory</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="https://github.com/user/repo/tree/main/skills/my-skill"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleInstallFromUrl()}
                  />
                </div>
              ) : (
                <div
                  className={`dropzone ${dragActive ? "active" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <p>Drop .md or .zip file here</p>
                  <p style={{ fontSize: 12, marginTop: 8 }}>or click to browse</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.zip"
                    style={{ display: "none" }}
                    onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  />
                </div>
              )}
            </div>
            <div className="dialog-footer">
              <button className="btn" onClick={() => setShowDialog(false)}>Cancel</button>
              {installMode === "url" && (
                <button className="btn btn-primary" onClick={handleInstallFromUrl} disabled={loading || !url.trim()}>
                  {loading ? "Installing..." : "Install"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="dialog-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="dialog dialog-sm" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Confirm Delete</h2>
            </div>
            <div className="dialog-body">
              <p>Are you sure you want to delete "<strong>{deleteTarget}</strong>"?</p>
            </div>
            <div className="dialog-footer">
              <button className="btn" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
