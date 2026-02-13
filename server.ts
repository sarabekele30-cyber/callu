import { createServer } from "node:http";
import { parse } from "url";
import next from "next";
import { Server } from "socket.io";
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./models/User";
import Room from "./models/Room";

dotenv.config();

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

// Define port
const port = process.env.PORT || 3000;

// Connect to MongoDB
const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined");
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

// Initialize server
connectDB().then(() => {
  app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Socket.io setup
  const io = new Server(server, {
    cors: {
      origin: "*", // Adjust for production
      methods: ["GET", "POST"]
    }
  });

  // Store connected users (socketId -> userId)
  // In a real app, use Redis. For this MVP, in-memory is fine.
  const onlineUsers = new Map<string, string>(); // userId -> socketId
  const roomParticipants = new Map<string, Set<string>>(); // roomId -> Set of userIds
  const userSockets = new Map<string, string>(); // userId -> socketId for rooms

  io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    // User authenticates/identifies
    socket.on("identify", async (userId: string) => {
      console.log(`User ${userId} identified with socket ${socket.id}`);
      
      // Store userId in socket.data for easy access on disconnect
      socket.data.userId = userId;
      onlineUsers.set(userId, socket.id);
      
      // Broadcast to others that this user came online
      socket.broadcast.emit("user-online", userId);
      
      // Send current online user list to the new user
      socket.emit("online-users-list", Array.from(onlineUsers.keys()));
      
      // Emit consolidated list to all clients
      io.emit("online-users-list", Array.from(onlineUsers.keys()));
    });

    // Room Events
    socket.on("join-room", (data: { roomId: string; userId: string; userName: string; avatar: string | null; color: string }) => {
      const { roomId, userId, userName, avatar, color } = data;
      console.log(`User ${userName} (${userId}) joining room ${roomId}`);
      
      socket.join(roomId);
      userSockets.set(userId, socket.id);
      socket.data.currentRoom = roomId;
      socket.data.userId = userId;
      
      if (!roomParticipants.has(roomId)) {
        roomParticipants.set(roomId, new Set());
      }
      roomParticipants.get(roomId)!.add(userId);
      
      // Notify others in the room
      socket.to(roomId).emit("room-user-joined", { userId, userName, avatar, color });
      
      // Send current participants to the joining user
      const participants = Array.from(roomParticipants.get(roomId) || []).map(uid => ({
        userId: uid,
        name: userName, // In production, fetch from DB
        avatar: avatar,
        color: color,
        isSpeaking: false,
      }));
      socket.emit("room-participants", { participants });
    });

    socket.on("leave-room", (data: { roomId: string; userId: string }) => {
      const { roomId, userId } = data;
      console.log(`User ${userId} leaving room ${roomId}`);
      
      socket.leave(roomId);
      userSockets.delete(userId);
      
      if (roomParticipants.has(roomId)) {
        roomParticipants.get(roomId)!.delete(userId);
        if (roomParticipants.get(roomId)!.size === 0) {
          roomParticipants.delete(roomId);
        }
      }
      
      socket.to(roomId).emit("room-user-left", { userId });
    });

    socket.on("room-signal", (data: { roomId: string; targetUserId: string; signal: any }) => {
      const { roomId, targetUserId, signal } = data;
      const targetSocketId = userSockets.get(targetUserId);
      
      if (targetSocketId) {
        io.to(targetSocketId).emit("room-signal", {
          fromUserId: socket.data.userId,
          signal,
        });
      }
    });

    socket.on("user-speaking", (data: { roomId: string; userId: string; isSpeaking: boolean }) => {
      const { roomId, userId, isSpeaking } = data;
      // Broadcast speaking status to all other users in the room
      socket.to(roomId).emit("user-speaking", { userId, isSpeaking });
    });

    // Generic Signaling for WebRTC (SimplePeer or Raw)
    socket.on("send-signal", (data) => {
      const socketIdToCall = onlineUsers.get(data.to);
      if (socketIdToCall) {
        io.to(socketIdToCall).emit("signal-received", { 
          signal: data.signal, 
          from: data.from // userId of sender
        });
      }
    });

    // Keeping these for specific initial call intent if needed, but generic is better
    socket.on("call-user", ({ userToCall, signalData, from, name, avatar }) => {
      const socketIdToCall = onlineUsers.get(userToCall);
      if (socketIdToCall) {
        io.to(socketIdToCall).emit("call-made", { signal: signalData, from, name, avatar }); // from is userId
      }
    });

    socket.on("answer-call", (data) => {
      const socketIdToCall = onlineUsers.get(data.to);
      if (socketIdToCall) {
        io.to(socketIdToCall).emit("call-answered", { signal: data.signal, from: data.from });
      }
    });

    // Handle call termination
    socket.on("end-call", (data) => {
      const socketIdToCall = onlineUsers.get(data.to);
      if (socketIdToCall) {
        console.log(`Call ended by ${data.from}, notifying ${data.to}`);
        io.to(socketIdToCall).emit("call-ended", { from: data.from });
      }
    });
    
    // Status updates
    socket.on("disconnect", (reason) => {
      const userId = socket.data.userId;
      const currentRoom = socket.data.currentRoom;
      console.log(`Client disconnected: ${socket.id}, userId: ${userId}, reason: ${reason}`);
      
      if (userId && onlineUsers.has(userId)) {
        onlineUsers.delete(userId);
        // Broadcast to all clients that user went offline
        io.emit("user-offline", userId);
        // Emit updated online users list
        io.emit("online-users-list", Array.from(onlineUsers.keys()));
      }
      
      // Handle room disconnection
      if (currentRoom && userId) {
        if (roomParticipants.has(currentRoom)) {
          roomParticipants.get(currentRoom)!.delete(userId);
          if (roomParticipants.get(currentRoom)!.size === 0) {
            roomParticipants.delete(currentRoom);
          }
        }
        userSockets.delete(userId);
        socket.to(currentRoom).emit("room-user-left", { userId });
      }
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
  });});