import { useState } from "react";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import type { ProjectEntry } from "../api/client.js";

interface Props {
  projects: ProjectEntry[];
  activeIndex: number;
  onSwitch: (index: number) => void;
  onAdd: (rootPath: string) => void;
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

  return (
    <div className="project-switcher">
      <div className="project-header-row">
        <span className="project-current">{activeProject?.label ?? "—"}</span>
        {projects.length > 1 && (
          <Button
            label={open ? "Close" : "Switch"}
            icon={open ? "pi pi-chevron-up" : "pi pi-chevron-down"}
            size="small"
            outlined
            onClick={() => setOpen((v) => !v)}
          />
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
        <InputText
          placeholder="Absolute path to project root"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1"
        />
        <Button label="Add project" size="small" onClick={handleAdd} />
      </div>
    </div>
  );
}
