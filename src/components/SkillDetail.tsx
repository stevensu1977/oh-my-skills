import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, FolderOpen, ExternalLink, File, Folder, ChevronRight, ChevronDown } from "lucide-react";
import type { AgentType, SkillInfo, SkillMetadata, FileItem } from "../types";

interface Props {
  agent: AgentType;
  skill: SkillInfo;
  onBack: () => void;
  showToast: (message: string, type?: "success" | "error") => void;
}

interface FileTreeItemProps {
  item: FileItem;
  agent: AgentType;
  skillName: string;
  level: number;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

function FileTreeItem({ item, agent, skillName, level, selectedFile, onSelectFile }: FileTreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadChildren = async () => {
    if (children.length > 0) {
      setExpanded(!expanded);
      return;
    }

    setLoading(true);
    try {
      const items = await invoke<FileItem[]>("list_skill_files", {
        agent,
        name: skillName,
        subpath: item.path,
      });
      setChildren(items);
      setExpanded(true);
    } catch (e) {
      console.error("Failed to load children:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = () => {
    if (item.is_directory) {
      loadChildren();
    } else {
      onSelectFile(item.path);
    }
  };

  const isSelected = selectedFile === item.path;

  return (
    <div>
      <div
        className={`file-tree-item ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${12 + level * 16}px` }}
        onClick={handleClick}
      >
        {item.is_directory ? (
          <>
            {loading ? (
              <span className="file-tree-icon loading">...</span>
            ) : expanded ? (
              <ChevronDown size={14} className="file-tree-icon" />
            ) : (
              <ChevronRight size={14} className="file-tree-icon" />
            )}
            <Folder size={14} className="file-tree-icon folder" />
          </>
        ) : (
          <>
            <span className="file-tree-icon" style={{ width: 14 }} />
            <File size={14} className="file-tree-icon file" />
          </>
        )}
        <span className="file-tree-name">{item.name}</span>
        {!item.is_directory && item.size !== null && (
          <span className="file-tree-size">{formatSize(item.size)}</span>
        )}
      </div>
      {expanded && children.length > 0 && (
        <div className="file-tree-children">
          {children.map((child) => (
            <FileTreeItem
              key={child.path}
              item={child}
              agent={agent}
              skillName={skillName}
              level={level + 1}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function SkillDetail({ agent, skill, onBack, showToast }: Props) {
  const [metadata, setMetadata] = useState<SkillMetadata | null>(null);
  const [skillContent, setSkillContent] = useState<string>("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"content" | "files">("content");
  const [loadingContent, setLoadingContent] = useState(true);

  const loadData = useCallback(async () => {
    setLoadingContent(true);
    try {
      const [meta, content, fileList] = await Promise.all([
        invoke<SkillMetadata | null>("get_skill_metadata", { agent, name: skill.name }),
        invoke<string>("get_skill_content", { agent, name: skill.name }),
        invoke<FileItem[]>("list_skill_files", { agent, name: skill.name, subpath: null }),
      ]);
      setMetadata(meta);
      setSkillContent(content);
      setFiles(fileList);
    } catch (e) {
      showToast(`Failed to load skill details: ${e}`, "error");
    } finally {
      setLoadingContent(false);
    }
  }, [agent, skill.name, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectFile = async (path: string) => {
    setSelectedFile(path);
    try {
      const content = await invoke<string>("read_skill_file", {
        agent,
        name: skill.name,
        filePath: path,
      });
      setFileContent(content);
    } catch (e) {
      setFileContent(`Error loading file: ${e}`);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await invoke("open_skill_folder", { agent, name: skill.name });
    } catch (e) {
      showToast(`Failed to open folder: ${e}`, "error");
    }
  };

  const formatTokens = (count: number | null) => {
    if (!count) return "";
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k tokens`;
    return `${count} tokens`;
  };

  return (
    <div className="skill-detail">
      {/* Header */}
      <div className="skill-detail-header">
        <button className="btn btn-icon" onClick={onBack} title="Back to list">
          <ArrowLeft size={18} />
        </button>
        <div className="skill-detail-title">
          <h2>{skill.name}</h2>
          {metadata?.description && (
            <div className="skill-detail-description">{metadata.description}</div>
          )}
          <div className="skill-detail-meta">
            {skill.token_count && <span>{formatTokens(skill.token_count)}</span>}
            {metadata?.author && <span>by {metadata.author}</span>}
            {metadata?.installed_at && <span>Installed: {formatDate(metadata.installed_at)}</span>}
          </div>
        </div>
        <div className="skill-detail-actions">
          <button className="btn btn-icon" onClick={handleOpenFolder} title="Open folder">
            <FolderOpen size={16} />
          </button>
          {metadata?.source && metadata.source.startsWith("http") && (
            <a
              href={metadata.source}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-icon"
              title="Open source"
            >
              <ExternalLink size={16} />
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="skill-detail-tabs">
        <button
          className={`skill-detail-tab ${activeTab === "content" ? "active" : ""}`}
          onClick={() => setActiveTab("content")}
        >
          SKILL.md
        </button>
        <button
          className={`skill-detail-tab ${activeTab === "files" ? "active" : ""}`}
          onClick={() => setActiveTab("files")}
        >
          Files ({files.length})
        </button>
      </div>

      {/* Content */}
      <div className="skill-detail-content">
        {loadingContent ? (
          <div className="skill-detail-loading">Loading...</div>
        ) : activeTab === "content" ? (
          <div className="skill-detail-markdown">
            <pre>{skillContent}</pre>
          </div>
        ) : (
          <div className="skill-detail-files">
            <div className="file-explorer">
              <div className="file-tree">
                {files.map((item) => (
                  <FileTreeItem
                    key={item.path}
                    item={item}
                    agent={agent}
                    skillName={skill.name}
                    level={0}
                    selectedFile={selectedFile}
                    onSelectFile={handleSelectFile}
                  />
                ))}
              </div>
              <div className="file-preview">
                {selectedFile ? (
                  <>
                    <div className="file-preview-header">{selectedFile}</div>
                    <pre className="file-preview-content">{fileContent}</pre>
                  </>
                ) : (
                  <div className="file-preview-empty">Select a file to view</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
