import { useState, useRef, useCallback } from "react";

export type WsStatus = "disconnected" | "connecting" | "connected" | "error";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export function useWebSocket(url: string) {
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("disconnected");
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current) wsRef.current.close();
    setMessages([]);
    setStatus("connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("error");
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        setMessages((prev) => [...prev, msg]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { type: "raw", text: event.data as string },
        ]);
      }
    };
  }, [url]);

  const send = useCallback((msg: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connect, disconnect, send, messages, status };
}
