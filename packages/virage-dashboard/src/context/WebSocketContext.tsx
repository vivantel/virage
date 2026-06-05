import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type WsStatus = "disconnected" | "connecting" | "connected" | "error";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

interface WsContextValue {
  status: WsStatus;
  operationRunning: boolean;
  messages: WsMessage[];
  startOp: (msg: unknown) => void;
}

const TERMINAL_TYPES = new Set(["done", "error", "busy"]);
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

const WebSocketContext = createContext<WsContextValue>({
  status: "disconnected",
  operationRunning: false,
  messages: [],
  startOp: () => undefined,
});

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [operationRunning, setOperationRunning] = useState(false);

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
      setMessages((prev) => [...prev, msg]);
      if (TERMINAL_TYPES.has(msg.type)) {
        setOperationRunning(false);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus("disconnected");

      if (retryCountRef.current < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, retryCountRef.current);
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        setStatus("error");
      }
    };

    ws.onerror = () => {
      // onclose fires right after; let it handle reconnect
    };
  }, []);

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
      value={{ status, operationRunning, messages, startOp }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWs(): WsContextValue {
  return useContext(WebSocketContext);
}
