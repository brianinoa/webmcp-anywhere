import { DurableObject } from "cloudflare:workers";
import type { RoomRole } from "@webmcp-anywhere/shared";

/**
 * Room — a Durable Object that relays `RoomMessage` JSON between a controlled
 * TARGET (the extension driving a browser tab) and one or more REMOTEs (phones
 * running the /remote/:code page). It is stateless plumbing: all consent lives
 * at the target (see SECURITY.md). No persistence beyond the live socket set,
 * which the WebSocket hibernation API rebuilds for us via `getWebSockets()` and
 * per-socket `serializeAttachment({ role })`.
 */

/** Per-room connection caps. Extra sockets are accepted then closed with a reason. */
const MAX_TARGETS = 4;
const MAX_REMOTES = 8;

/** Close code for a rejected socket (application range 4000-4999). */
const CLOSE_ROOM_FULL = 4004;

interface Attachment {
  role: RoomRole;
}

export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    if (role !== "target" && role !== "remote") {
      return new Response("role must be target or remote", { status: 400 });
    }

    const tag = `role:${role}`;
    const cap = role === "target" ? MAX_TARGETS : MAX_REMOTES;
    const current = this.ctx.getWebSockets(tag).length;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    if (current >= cap) {
      // Accept just so we can deliver a close frame with a human-readable reason.
      server.accept();
      server.close(CLOSE_ROOM_FULL, `Room full: at most ${cap} ${role}s`);
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server, [tag]);
    server.serializeAttachment({ role } satisfies Attachment);
    this.broadcastPeers();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return; // relay only text frames
    let msg: { t?: unknown };
    try {
      msg = JSON.parse(message);
    } catch {
      return; // ignore malformed JSON
    }
    if (!msg || typeof msg.t !== "string") return;

    const role = (ws.deserializeAttachment() as Attachment | null)?.role;

    switch (msg.t) {
      case "ping":
        this.safeSend(ws, JSON.stringify({ t: "pong" }));
        return;
      case "pong":
      case "hello": // role is fixed at connect time; nothing to do
      case "peers": // relay never accepts inbound peers counts
        return;
      case "call":
        // A remote invokes a tool -> fan out to every target.
        if (role === "remote") this.relay("role:target", message);
        return;
      case "tools":
      case "result":
        // A target reports tools / results -> fan out to every remote.
        if (role === "target") this.relay("role:remote", message);
        return;
      default:
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closing/closed
    }
    this.broadcastPeers(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPeers(ws);
  }

  /** Send a raw (already-serialized) frame to every socket carrying `tag`. */
  private relay(tag: string, data: string): void {
    for (const ws of this.ctx.getWebSockets(tag)) this.safeSend(ws, data);
  }

  /** Tell everyone how many of each role are connected. `exclude` drops a socket that is leaving. */
  private broadcastPeers(exclude?: WebSocket): void {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== exclude);
    let targets = 0;
    let remotes = 0;
    for (const ws of sockets) {
      const role = (ws.deserializeAttachment() as Attachment | null)?.role;
      if (role === "target") targets++;
      else if (role === "remote") remotes++;
    }
    const frame = JSON.stringify({ t: "peers", targets, remotes });
    for (const ws of sockets) this.safeSend(ws, frame);
  }

  private safeSend(ws: WebSocket, data: string): void {
    try {
      ws.send(data);
    } catch {
      // socket not writable; a close event will clean it up
    }
  }
}
