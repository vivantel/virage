import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useToast } from "./ToastContext";
import type {
  StatusData,
  ChunksData,
  AnomaliesData,
  HistogramBucket,
  Anomaly,
} from "../api/client";

export type WsStatus = "disconnected" | "connecting" | "connected" | "error";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export interface DashboardSnapshot {
  status: StatusData;
  histogram: HistogramBucket[];
  anomalies: Anomaly[];
}

interface WsContextValue {
  status: WsStatus;
  operationRunning: boolean;
  messages: WsMessage[];
  /** The `op` string of the most recently started operation, null if none yet. */
  currentOp: string | null;
  /** Latest dashboard data pushed by the server (status + histogram + anomalies). */
  dashboardSnapshot: DashboardSnapshot | null;
  startOp: (msg: unknown) => void;
}

const TERMINAL_TYPES = new Set(["done", "error", "busy"]);
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

const WebSocketContext = createContext<WsContextValue>({
  status: "disconnected",
  operationRunning: false,
  messages: [],
  currentOp: null,
  dashboardSnapshot: null,
  startOp: () => undefined,
});

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [operationRunning, setOperationRunning] = useState(false);
  const [currentOp, setCurrentOp] = useState<string | null>(null);
  const [dashboardSnapshot, setDashboardSnapshot] =
    useState<DashboardSnapshot | null>(null);
  const { showError } = useToast();

  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMsgRef = useRef<unknown>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    const ws = new WebSocket("/ws");
    wsRef.current = ws;

    ws.onopen = () => {
      retryCountRef.current = 0;
      setStatus("connected");
      if (pendingMsgRef.current !== null) {
        ws.send(JSON.stringify(pendingMsgRef.current));
        pendingMsgRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(event.data as string) as WsMessage;
      } catch {
        msg = { type: "raw", text: event.data as string };
      }

      // Dashboard pushes go to snapshot state, not the pipeline log
      if (msg.type === "dashboard-update") {
        const payload = msg as unknown as {
          type: string;
          status: StatusData;
          histogram: ChunksData;
          anomalies: AnomaliesData;
        };
        setDashboardSnapshot({
          status: payload.status,
          histogram: payload.histogram?.histogram ?? [],
          anomalies: payload.anomalies?.anomalies ?? [],
        });
        return;
      }

      setMessages((prev) => [...prev, msg]);
      if (TERMINAL_TYPES.has(msg.type)) {
        setOperationRunning(false);
        if (msg.type === "error") {
          showError(
            "Operation failed",
            String(msg["message"] ?? "Unknown error"),
          );
        }
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus("disconnected");
      const delay = Math.min(
        BASE_DELAY_MS * Math.pow(2, retryCountRef.current),
        MAX_DELAY_MS,
      );
      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose fires right after; let it handle reconnect
    };
  }, [showError]);

  useEffect(() => {
    connect();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const startOp = useCallback(
    (msg: unknown) => {
      setMessages([]);
      setOperationRunning(true);
      if (msg && typeof msg === "object" && "op" in msg) {
        setCurrentOp(String((msg as { op: unknown }).op));
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      } else {
        pendingMsgRef.current = msg;
        connect();
      }
    },
    [connect],
  );

  return (
    <WebSocketContext.Provider
      value={{
        status,
        operationRunning,
        messages,
        currentOp,
        dashboardSnapshot,
        startOp,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWs(): WsContextValue {
  return useContext(WebSocketContext);
}
