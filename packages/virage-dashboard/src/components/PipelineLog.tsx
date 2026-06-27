import { useEffect, useRef } from "react";
import { useWs, type WsMessage } from "../context/WebSocketContext";

export function formatMessage(msg: WsMessage): string {
  if (msg.type === "progress") {
    if (msg["message"])
      return `[${String(msg["stage"] ?? "info")}] ${String(msg["message"])}`;
    return `[${String(msg["stage"] ?? "progress")}] ${String(msg["done"] ?? 0)} / ${String(msg["total"] ?? "?")}`;
  }
  if (msg.type === "done") {
    const extra = msg["message"] ? ` — ${String(msg["message"])}` : "";
    return `✓ Completed${extra}`;
  }
  if (msg.type === "error")
    return `✗ Error: ${String(msg["message"] ?? "unknown")}`;
  if (msg.type === "busy")
    return "⚠ Server busy — another operation is running";
  if (msg.type === "raw") return String(msg["text"] ?? "");
  return JSON.stringify(msg);
}

interface PipelineLogProps {
  /**
   * Only render when currentOp is one of these values.
   * Pass [] to always show (no op filtering).
   */
  allowedOps: string[];
  /** Optional heading above the log. */
  title?: string;
  /** Placeholder shown before any operation starts (requires alwaysShow). */
  placeholder?: string;
  /**
   * When true, show the log container even before an operation starts
   * (displays placeholder if provided). Useful for the Pipeline page
   * which should always render its log area.
   */
  alwaysShow?: boolean;
}

export function PipelineLog({
  allowedOps,
  title,
  placeholder,
  alwaysShow = false,
}: PipelineLogProps) {
  const { messages, currentOp } = useWs();
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  // Determine if this log section is allowed to show based on the current op:
  // - allowedOps=[] → always allowed
  // - alwaysShow && currentOp===null → allowed (initial state, show placeholder)
  // - currentOp is in allowedOps → allowed
  const opAllowed =
    allowedOps.length === 0 ||
    (alwaysShow && currentOp === null) ||
    (currentOp !== null && allowedOps.includes(currentOp));

  if (!opAllowed) return null;
  if (messages.length === 0 && !placeholder) return null;

  return (
    <div className="pipeline-log-wrapper">
      {title && <h4 className="pipeline-log-title">{title}</h4>}
      <pre ref={logRef} className="pipeline-log">
        {messages.length === 0
          ? placeholder
          : messages.map(formatMessage).join("\n")}
      </pre>
    </div>
  );
}
