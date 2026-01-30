import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Trash2, Search, Download } from "lucide-react";
import type { AgentType, SkillInfo, SearchSkill } from "../types";
import SkillDetail from "./SkillDetail";

interface Props {
  agent: AgentType;
  skills: SkillInfo[];
  onRefresh: () => void;
  showToast: (message: string, type?: "success" | "error") => void;
}

export default function SkillsPanel({ agent, skills, onRefresh, showToast }: Props) {
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [installMode, setInstallMode] = useState<"search" | "url" | "file">("search");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchSkill[]>([]);
  const [searching, setSearching] = useState(false);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await invoke<SearchSkill[]>("search_skills", { query });
      setSearchResults(results);
    } catch (e) {
      console.error("Search failed:", e);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (searchQuery.trim()) {
      const delay = searchQuery.length <= 2 ? 300 : 150;
      searchTimeoutRef.current = setTimeout(() => {
        doSearch(searchQuery);
      }, delay);
    } else {
      setSearchResults([]);
    }
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, doSearch]);

  const handleInstallFromSearch = async (skill: SearchSkill) => {
    const source = skill.source || skill.slug;
    if (!source) {
      showToast("No source available for this skill", "error");
      return;
    }
    setInstallingSlug(skill.slug);
    try {
      const skillUrl = `https://github.com/${source}`;
      const result = await invoke<string>("install_skill_from_url", { agent, url: skillUrl });
      showToast(result);
      onRefresh();
    } catch (e) {
      showToast(`${e}`, "error");
    } finally {
      setInstallingSlug(null);
    }
  };

  const formatInstalls = (count: number) => {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
  };

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

  // Show detail view if a skill is selected
  if (selectedSkill) {
    return (
      <SkillDetail
        agent={agent}
        skill={selectedSkill}
        onBack={() => setSelectedSkill(null)}
        showToast={showToast}
      />
    );
  }

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
            <div key={skill.name} className="list-item clickable" onClick={() => setSelectedSkill(skill)}>
              <div className="list-item-info">
                <div className="list-item-name">{skill.name}</div>
                <div className="list-item-meta">{formatTokens(skill.token_count)}</div>
              </div>
              <div className="list-item-actions" onClick={(e) => e.stopPropagation()}>
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
                  className={`tab-btn ${installMode === "search" ? "active" : ""}`}
                  onClick={() => setInstallMode("search")}
                >
                  <Search size={14} style={{ marginRight: 4 }} />
                  Search
                </button>
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

              {installMode === "search" ? (
                <div className="search-container">
                  <div className="form-group">
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Search skills on skills.sh..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="search-results">
                    {searching ? (
                      <div className="search-loading">Searching...</div>
                    ) : searchResults.length > 0 ? (
                      searchResults.map((skill) => (
                        <div key={skill.slug} className="search-result-item">
                          <div className="search-result-info">
                            <div className="search-result-name">{skill.name}</div>
                            <div className="search-result-meta">
                              {skill.source && <span className="search-result-source">{skill.source}</span>}
                              <span className="search-result-installs">{formatInstalls(skill.installs)} installs</span>
                            </div>
                          </div>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => handleInstallFromSearch(skill)}
                            disabled={installingSlug === skill.slug}
                          >
                            {installingSlug === skill.slug ? (
                              "..."
                            ) : (
                              <Download size={14} />
                            )}
                          </button>
                        </div>
                      ))
                    ) : searchQuery.trim() ? (
                      <div className="search-empty">No skills found</div>
                    ) : (
                      <div className="search-empty">Type to search for skills</div>
                    )}
                  </div>
                </div>
              ) : installMode === "url" ? (
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
