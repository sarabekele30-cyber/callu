import { createServer } from "node:http";
import { parse } from "url";
import next from "next";
import { Server } from "socket.io";
import mongoose from "mongoose";
import dotenv from "dotenv";
import ImageKit from "imagekit";
import { logConfigStatus } from "./lib/validateConfig";
import User from "./models/User";
import Room from "./models/Room";
import RoomChatUpload from "./models/RoomChatUpload";

dotenv.config();

// Validate email configuration at startup
logConfigStatus();

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
  const roomParticipants = new Map<string, Map<string, { name: string; avatar: string | null; color: string; isVideoOn: boolean; isScreenSharing: boolean }>>(); // roomId -> Map of userId -> profile
  const userSockets = new Map<string, string>(); // userId -> socketId for rooms
  const roomChatMessages = new Map<string, Array<{
    id: string;
    roomId: string;
    userId: string;
    userName: string;
    userAvatar?: string | null;
    content: string;
    attachments?: Array<{ key: string; url: string; name: string; type: string; size: number; expiresAt: string }>;
    createdAt: string;
  }>>();
  const roomWatchState = new Map<string, {
    videoId: string;
    isPlaying: boolean;
    time: number;
    startTime?: number;
    startedBy?: string;
    type?: string;
    updatedAt: number;
  }>();

  const imagekitPublicKey = process.env.IMAGEKIT_PUBLIC_KEY;
  const imagekitPrivateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  const imagekitUrlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;
  const canCleanupImageKit = Boolean(imagekitPublicKey && imagekitPrivateKey && imagekitUrlEndpoint);
  const imagekit = canCleanupImageKit
    ? new ImageKit({
        publicKey: imagekitPublicKey!,
        privateKey: imagekitPrivateKey!,
        urlEndpoint: imagekitUrlEndpoint!,
      })
    : null;

  const cleanupExpiredChatUploads = async () => {
    if (!imagekit) return;
    const now = new Date();
    const expired = await RoomChatUpload.find({
      expiresAt: { $lte: now },
      deletedAt: { $exists: false },
      provider: "imagekit",
    } as any).limit(200);

    for (const upload of expired) {
      try {
        await imagekit.deleteFile(upload.fileId || upload.key);
        upload.deletedAt = new Date();
        await upload.save();
      } catch (error) {
        console.error("Failed to delete expired chat upload:", upload.key, error);
      }
    }
  };

  if (canCleanupImageKit) {
    cleanupExpiredChatUploads().catch((error) => {
      console.error("Initial chat upload cleanup failed:", error);
    });
    setInterval(() => {
      cleanupExpiredChatUploads().catch((error) => {
        console.error("Scheduled chat upload cleanup failed:", error);
      });
    }, 60 * 60 * 1000);
  } else {
    console.warn("ImageKit chat cleanup disabled: missing ImageKit environment variables");
  }

  const emitRoomCount = (roomId: string) => {
    const participantsMap = roomParticipants.get(roomId);
    const count = participantsMap?.size || 0;
    const participants = participantsMap 
      ? Array.from(participantsMap.values()).slice(0, 5).map(p => ({
          name: p.name,
          avatar: p.avatar,
          color: p.color
        }))
      : [];
    
    io.emit("room-count-updated", { roomId, count, participants });
  };

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

      // If user was already in another room, leave it first
      const prevRoomId = socket.data.currentRoom as string | undefined;
      if (prevRoomId && prevRoomId !== roomId) {
        socket.leave(prevRoomId);
        if (roomParticipants.has(prevRoomId)) {
          roomParticipants.get(prevRoomId)!.delete(userId);
          if (roomParticipants.get(prevRoomId)!.size === 0) {
            roomParticipants.delete(prevRoomId);
            roomChatMessages.delete(prevRoomId);
            roomWatchState.delete(prevRoomId);
          }
        }
        socket.to(prevRoomId).emit("room-user-left", { userId });
        emitRoomCount(prevRoomId);
      }
      
      socket.join(roomId);
      userSockets.set(userId, socket.id);
      socket.data.currentRoom = roomId;
      socket.data.userId = userId;
      
      if (!roomParticipants.has(roomId)) {
        roomParticipants.set(roomId, new Map());
      }
      roomParticipants.get(roomId)!.set(userId, { name: userName, avatar, color, isVideoOn: false, isScreenSharing: false });
      
      // Notify others in the room
      socket.to(roomId).emit("room-user-joined", { userId, userName, avatar, color });
      
      // Send current participants to the joining user
      const participants = Array.from(roomParticipants.get(roomId)?.entries() || []).map(([uid, profile]) => ({
        userId: uid,
        name: profile.name,
        avatar: profile.avatar,
        color: profile.color,
        isSpeaking: false,
        isVideoOn: profile.isVideoOn,
        isScreenSharing: profile.isScreenSharing,
      }));
      socket.emit("room-participants", { participants });
      const history = roomChatMessages.get(roomId) || [];
      socket.emit("room-chat-history", { roomId, messages: history });
      const watchState = roomWatchState.get(roomId);
      if (watchState) {
        socket.emit("watch-state-sync", { roomId, state: watchState });
      }
      emitRoomCount(roomId);
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
          roomChatMessages.delete(roomId);
          roomWatchState.delete(roomId);
        }
      }
      
      socket.to(roomId).emit("room-user-left", { userId });
      emitRoomCount(roomId);
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

    socket.on("room-video-toggle", (data: { roomId: string; userId: string; isVideoOn: boolean }) => {
      const { roomId, userId, isVideoOn } = data;
      const participants = roomParticipants.get(roomId);
      if (participants && participants.has(userId)) {
        const profile = participants.get(userId)!;
        profile.isVideoOn = isVideoOn;
      }
      socket.to(roomId).emit("room-video-toggle", { userId, isVideoOn });
    });

    socket.on("room-screen-share", (data: { roomId: string; userId: string; isSharing: boolean }) => {
      const { roomId, userId, isSharing } = data;
      const participants = roomParticipants.get(roomId);
      if (participants && participants.has(userId)) {
        const profile = participants.get(userId)!;
        profile.isScreenSharing = isSharing;
      }
      socket.to(roomId).emit("room-screen-share", { userId, isSharing });
    });

    socket.on("room-chat-history-request", (data: { roomId: string }) => {
      const history = roomChatMessages.get(data.roomId) || [];
      socket.emit("room-chat-history", { roomId: data.roomId, messages: history });
    });

    socket.on("room-chat-message", (message: { roomId: string; id?: string; userId: string; userName: string; userAvatar?: string | null; content: string; attachments?: Array<{ key: string; url: string; name: string; type: string; size: number; expiresAt: string }>; createdAt?: string }) => {
      if (!message.roomId) return;
      const normalized = {
        ...message,
        id: message.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        createdAt: message.createdAt || new Date().toISOString(),
      };

      const history = roomChatMessages.get(message.roomId) || [];
      history.push(normalized);
      if (history.length > 200) {
        history.splice(0, history.length - 200);
      }
      roomChatMessages.set(message.roomId, history);

      io.in(message.roomId).emit("room-chat-message", normalized);
    });

    // ─── Watch Together (shared video) ──────────────────────────
    socket.on("watch-state-request", (data: { roomId: string }) => {
      if (!data.roomId) return;
      const state = roomWatchState.get(data.roomId);
      if (state) {
        socket.emit("watch-state-sync", { roomId: data.roomId, state });
      }
    });

    socket.on("watch-set", (data: { roomId: string; videoId: string; startTime?: number; startedBy?: string; type?: string }) => {
      if (!data.roomId || !data.videoId) return;
      const state = {
        videoId: data.videoId,
        isPlaying: true,
        time: 0,
        startTime: data.startTime || Date.now(),
        startedBy: data.startedBy,
        type: data.type,
        updatedAt: Date.now(),
      };
      roomWatchState.set(data.roomId, state);
      io.in(data.roomId).emit("watch-set", { roomId: data.roomId, videoId: data.videoId, startTime: state.startTime, startedBy: data.startedBy, type: data.type });
    });

    socket.on("watch-play", (data: { roomId: string; time?: number; timestamp?: number }) => {
      if (!data.roomId) return;
      const existing = roomWatchState.get(data.roomId);
      if (existing) {
        existing.isPlaying = true;
        if (typeof data.time === "number") existing.time = data.time;
        if (typeof data.timestamp === "number") existing.startTime = data.timestamp - (data.time || 0) * 1000;
        existing.updatedAt = Date.now();
      }
      io.in(data.roomId).emit("watch-play", { roomId: data.roomId, time: data.time, timestamp: data.timestamp });
    });

    socket.on("watch-pause", (data: { roomId: string; time?: number; timestamp?: number }) => {
      if (!data.roomId) return;
      const existing = roomWatchState.get(data.roomId);
      if (existing) {
        existing.isPlaying = false;
        if (typeof data.time === "number") existing.time = data.time;
        existing.updatedAt = Date.now();
      }
      io.in(data.roomId).emit("watch-pause", { roomId: data.roomId, time: data.time, timestamp: data.timestamp });
    });

    socket.on("watch-seek", (data: { roomId: string; time: number; timestamp?: number }) => {
      if (!data.roomId || typeof data.time !== "number") return;
      const existing = roomWatchState.get(data.roomId);
      if (existing) {
        existing.time = data.time;
        if (typeof data.timestamp === "number") existing.startTime = data.timestamp - data.time * 1000;
        existing.updatedAt = Date.now();
      }
      io.in(data.roomId).emit("watch-seek", { roomId: data.roomId, time: data.time, timestamp: data.timestamp });
    });

    socket.on("rooms-counts-request", () => {
      const counts = Array.from(roomParticipants.entries()).map(([roomId, members]) => ({
        roomId,
        count: members.size,
        participants: Array.from(members.values()).slice(0, 5).map(p => ({
          name: p.name,
          avatar: p.avatar,
          color: p.color
        }))
      }));
      socket.emit("rooms-counts", { counts });
    });

    // ─── Music Bot Events ──────────────────────────────────────────
    socket.on("music-add-to-queue", (data: { roomId: string; song: { videoId: string; title: string; thumbnail: string; duration: string; addedBy: string; addedByName: string } }) => {
      const { roomId, song } = data;
      // Broadcast to ALL in room (including sender, so their state syncs)
      io.in(roomId).emit("music-add-to-queue", { song });
    });

    socket.on("music-play", (data: { roomId: string; index?: number }) => {
      const { roomId, index } = data;
      io.in(roomId).emit("music-play", { index });
    });

    socket.on("music-pause", (data: { roomId: string }) => {
      io.in(data.roomId).emit("music-pause", {});
    });

    socket.on("music-resume", (data: { roomId: string }) => {
      io.in(data.roomId).emit("music-resume", {});
    });

    socket.on("music-skip", (data: { roomId: string }) => {
      io.in(data.roomId).emit("music-skip", {});
    });

    socket.on("music-prev", (data: { roomId: string }) => {
      io.in(data.roomId).emit("music-prev", {});
    });

    socket.on("music-seek", (data: { roomId: string; time: number }) => {
      socket.to(data.roomId).emit("music-seek", { time: data.time });
    });

    socket.on("music-repeat", (data: { roomId: string; repeat: boolean }) => {
      io.in(data.roomId).emit("music-repeat", { repeat: data.repeat });
    });

    socket.on("music-stop", (data: { roomId: string }) => {
      io.in(data.roomId).emit("music-stop", {});
    });

    socket.on("music-remove-from-queue", (data: { roomId: string; index: number }) => {
      const { roomId, index } = data;
      io.in(roomId).emit("music-remove-from-queue", { index });
    });

    socket.on("music-clear-queue", (data: { roomId: string }) => {
      io.in(data.roomId).emit("music-clear-queue", {});
    });

    // When a new user joins a room, they request current music state
    socket.on("music-request-state", (data: { roomId: string }) => {
      // Ask everyone in the room (only the "host"/first responder replies)
      socket.to(data.roomId).emit("music-state-request", { requesterId: socket.data.userId });
    });

    socket.on("music-state-response", (data: { roomId: string; requesterId: string; state: any }) => {
      const { requesterId, state } = data;
      const targetSocketId = userSockets.get(requesterId);
      if (targetSocketId) {
        io.to(targetSocketId).emit("music-state-sync", { state });
      }
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
    socket.on("call-user", ({ userToCall, signalData, from, name, avatar, callType }) => {
      const socketIdToCall = onlineUsers.get(userToCall);
      if (socketIdToCall) {
        io.to(socketIdToCall).emit("call-made", { signal: signalData, from, name, avatar, callType }); // from is userId
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
            roomChatMessages.delete(currentRoom);
            roomWatchState.delete(currentRoom);
          }
        }
        userSockets.delete(userId);
        socket.to(currentRoom).emit("room-user-left", { userId });
        emitRoomCount(currentRoom);

        // Also clean up DB participants (handles browser refresh / crash)
        Room.updateOne(
          { _id: currentRoom },
          { $pull: { participants: userId } }
        ).catch((err: any) => console.error("Failed to remove user from room DB on disconnect:", err));
      }
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
  });});