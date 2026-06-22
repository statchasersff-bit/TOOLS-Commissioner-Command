/**
 * Socket.io layer for the dispersal draft. Attached to the app's existing
 * httpServer on path `/api/ws`. Clients emit `join:room` with a share code to
 * join the `room:<shareCode>` broadcast group; the REST handlers emit
 * `draft:update` / `chat:message` / `chat:update` to that group.
 */
import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";

let io: SocketIOServer | null = null;

export function initDispersalSocket(httpServer: HttpServer): SocketIOServer {
  if (io) return io;
  io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/api/ws",
    // Don't let socket.io's engine claim every upgrade — only its own path.
    serveClient: false,
  });

  io.on("connection", (socket) => {
    socket.on("join:room", (roomCode: string) => {
      if (typeof roomCode === "string" && roomCode) {
        socket.join(`room:${roomCode}`);
      }
    });
  });

  return io;
}

export function getIo(): SocketIOServer | null {
  return io;
}
