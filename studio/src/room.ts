import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomMessage, ToolSummary } from "@webmcp-anywhere/shared";
import { API_BASE } from "./api";

/** Derive the WebSocket base from the API base (same-origin in prod, local worker in dev). */
export function roomSocketUrl(code: string, role: "remote"): string {
  const httpBase = API_BASE || window.location.origin;
  const wsBase = httpBase.replace(/^http/i, "ws"); // http->ws, https->wss
  return `${wsBase}/api/room/${encodeURIComponent(code)}?role=${role}`;
}

export type ConnState = "connecting" | "open" | "reconnecting";

export interface CallEntry {
  callId: string;
  tool: string;
  input: Record<string, unknown>;
  status: "pending" | "ok" | "error" | "blocked";
  result?: string;
  error?: string;
  at: number;
}

export interface RoomState {
  conn: ConnState;
  peers: { targets: number; remotes: number };
  tools: ToolSummary[];
  page?: { url: string; title?: string };
  log: CallEntry[];
  call: (tool: string, input: Record<string, unknown>) => void;
}

const CALL_TIMEOUT_MS = 30_000;
const HEARTBEAT_MS = 25_000;
const MAX_LOG = 40;

/**
 * Connects a /remote page to the Room relay as a "remote", with reconnect + backoff.
 * All the socket lifecycle lives here so the page is just a view.
 */
export function useRoom(code: string): RoomState {
  const [conn, setConn] = useState<ConnState>("connecting");
  const [peers, setPeers] = useState({ targets: 0, remotes: 0 });
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [page, setPage] = useState<{ url: string; title?: string } | undefined>();
  const [log, setLog] = useState<CallEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(500);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const send = useCallback((msg: RoomMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const settle = useCallback((callId: string, patch: Partial<CallEntry>) => {
    const t = timersRef.current[callId];
    if (t) {
      clearTimeout(t);
      delete timersRef.current[callId];
    }
    setLog((prev) => prev.map((e) => (e.callId === callId ? { ...e, ...patch } : e)));
  }, []);

  const call = useCallback(
    (tool: string, input: Record<string, unknown>) => {
      const callId =
        (globalThis.crypto?.randomUUID?.() as string | undefined) ?? `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const entry: CallEntry = { callId, tool, input, status: "pending", at: Date.now() };
      setLog((prev) => [entry, ...prev].slice(0, MAX_LOG));
      send({ t: "call", callId, tool, input });
      timersRef.current[callId] = setTimeout(() => {
        settle(callId, { status: "error", error: "No response from device (timed out)." });
      }, CALL_TIMEOUT_MS);
    },
    [send, settle],
  );

  useEffect(() => {
    let closedByUnmount = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(roomSocketUrl(code, "remote"));
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        backoffRef.current = 500;
        setConn("open");
        ws.send(JSON.stringify({ t: "hello", role: "remote" } satisfies RoomMessage));
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "ping" } satisfies RoomMessage));
        }, HEARTBEAT_MS);
      });

      ws.addEventListener("message", (ev) => {
        let msg: RoomMessage;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }
        switch (msg.t) {
          case "peers":
            setPeers({ targets: msg.targets, remotes: msg.remotes });
            break;
          case "tools":
            setTools(msg.tools);
            setPage(msg.page);
            break;
          case "result":
            settle(msg.callId, {
              status: msg.blocked ? "blocked" : msg.ok ? "ok" : "error",
              result: msg.result,
              error: msg.error,
            });
            break;
          default:
            break;
        }
      });

      const onDrop = () => {
        if (heartbeat) clearInterval(heartbeat);
        if (closedByUnmount) return;
        setConn("reconnecting");
        reconnectTimer = setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, 8000);
      };
      ws.addEventListener("close", onDrop);
      ws.addEventListener("error", () => ws.close());
    };

    connect();

    return () => {
      closedByUnmount = true;
      if (heartbeat) clearInterval(heartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const t of Object.values(timersRef.current)) clearTimeout(t);
      timersRef.current = {};
      wsRef.current?.close();
    };
  }, [code, settle]);

  return { conn, peers, tools, page, log, call };
}
