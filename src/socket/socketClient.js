import { io } from "socket.io-client";
import { API_BASE_URL } from "../api/axios";

let socket;

const socketUrl = API_BASE_URL.replace(/\/api\/?$/, "");

export const getSocket = () => socket;

export const connectSocket = (token) => {
  if (!token) return null;
  if (socket?.connected) return socket;

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
  }
};
