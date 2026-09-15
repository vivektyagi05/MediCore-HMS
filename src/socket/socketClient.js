import { io } from "socket.io-client";
import { API_BASE_URL } from "../api/axios";

let socket;
let socketToken;

const socketUrl = API_BASE_URL.replace(/\/api\/?$/, "");

export const getSocket = () => socket;

export const connectSocket = (token) => {
  if (!token) return null;
  // Reuse the existing socket for the same token even while it is still
  // mid-handshake, not just once `.connected` is true -- a socket that
  // hasn't finished connecting yet is still "the" connection for this
  // user, and treating it as absent is exactly what let a second call
  // spin up a duplicate before the first one settled.
  if (socket && socketToken === token) return socket;

  // Token changed (e.g. a different user logged in) or no socket exists
  // yet -- close out any previous connection before opening a new one so
  // we never have two live sockets for the same browser tab.
  if (socket) {
    socket.disconnect();
  }

  socketToken = token;
  socket = io(socketUrl, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
    socketToken = undefined;
  }
};
