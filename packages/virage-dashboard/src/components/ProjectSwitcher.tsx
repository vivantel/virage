import { useState } from "react";
import type { ProjectEntry } from "../api/client.js";

interface Props {
  projects: ProjectEntry[];
  activeIndex: number;
  onSwitch: (index: number) => void;
  onAdd: (rootPath: string) => void;
  addError: string | null;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ProjectSwitcher({
  projects,
  activeIndex,
  onSwitch,
  onAdd,
  addError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const activeProject = projects[activeIndex];

  function handleAdd() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setInputValue("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleAdd();
  }

  return (
    <div className="project-switcher">
      <div className="project-header-row">
        <span className="project-current">{activeProject?.label ?? "—"}</span>
        {projects.length > 1 && (
          <button
            className="project-dropdown-toggle"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▲ close" : "▼ switch"}
          </button>
        )}
      </div>

      {open && (
        <ul className="project-list">
          {projects.map((p, i) => (
            <li
              key={p.rootPath}
              className={i === activeIndex ? "active" : ""}
              onClick={() => {
                if (i !== activeIndex) {
                  onSwitch(i);
                  setOpen(false);
                }
              }}
            >
              <span>{p.label}</span>
              <span className="project-path">{timeAgo(p.lastUsed)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="project-add-form">
        <input
          type="text"
          placeholder="Absolute path to project root"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button onClick={handleAdd}>Add project</button>
      </div>
      {addError && <span className="project-add-error">{addError}</span>}
    </div>
  );
}
