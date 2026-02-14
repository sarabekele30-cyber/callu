"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useRouter, useParams } from "next/navigation";
import { Volume2, VolumeX, PhoneOff, Users as UsersIcon, Mic, MicOff } from "lucide-react";
import { useSocket } from "@/context/SocketContext";

interface Room {
  _id: string;
  name: string;
  description: string;
  createdBy: {
    _id: string;
    name: string;
  };
  participants: Array<{
    _id: string;
    name: string;
    avatarConfig: {
      image?: string;
      color: string;
    };
  }>;
  maxParticipants: number;
  isActive: boolean;
  roomType: "public" | "private";
}

interface RoomParticipant {
  userId: string;
  name: string;
  avatar: string | null;
  color: string;
  isSpeaking: boolean;
}

export default function RoomVoiceChatPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const roomId = params?.roomId as string;
  const { socket } = useSocket();

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // Use ref for peer connections to avoid stale closure issues in socket callbacks
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioAnalyzers = useRef<Map<string, AnalyserNode>>(new Map());
  const localAnalyzer = useRef<AnalyserNode | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const animationFrames = useRef<Map<string, number>>(new Map());
  const iceCandidateBuffers = useRef<Map<string, RTCIceCandidateInit[]>>(new Map()); // Buffer ICE candidates per peer

  const ICE_CONFIG: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      {
        urls: "turn:a.relay.metered.ca:80",
        username: "87a60b73f341b6abffa20ad6",
        credential: "ePS6V5R5d+xpKOH8",
      },
      {
        urls: "turn:a.relay.metered.ca:443",
        username: "87a60b73f341b6abffa20ad6",
        credential: "ePS6V5R5d+xpKOH8",
      },
      {
        urls: "turn:a.relay.metered.ca:443?transport=tcp",
        username: "87a60b73f341b6abffa20ad6",
        credential: "ePS6V5R5d+xpKOH8",
      },
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: "all",
  };

  useEffect(() => {
    if (!user || !roomId) {
      router.push("/dashboard/members");
      return;
    }
    
    let isActive = true;
    
    const initializeRoom = async () => {
      await fetchRoomDetails();
      await joinRoomInDB();
      const stream = await setupLocalAudio();
      
      // Join socket room AFTER we have our audio stream ready
      // This ensures createPeerConnection has the stream when room-participants arrives
      if (socket && stream && user) {
        socket.emit("join-room", { roomId, userId: user._id, userName: user.name, avatar: user.avatarConfig?.image, color: user.avatarConfig?.color });
      }
    };
    
    initializeRoom();

    // Only cleanup on actual unmount (window unload or explicit leave)
    const handleBeforeUnload = () => {
      if (isActive) {
        leaveRoom();
        cleanupConnections();
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      isActive = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Don't auto-leave on component unmount (React strict mode causes double-mount)
      // User must explicitly click leave button
    };
  }, [user, roomId, router]);

  // ─── Unlock audio on first user interaction ─────────────
  useEffect(() => {
    let audioUnlocked = false;
    
    const unlock = () => {
      if (audioUnlocked) return;
      audioUnlocked = true;

      // Resume AudioContext to globally unlock audio playback
      if (audioContext.current && audioContext.current.state === 'suspended') {
        audioContext.current.resume();
      }

      // Try to unmute audio elements
      audioRefs.current.forEach((audio) => {
        if (audio.muted) {
          audio.muted = false;
          audio.play().catch(() => {});
        }
      });

      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("keydown", unlock);
    };

    document.addEventListener("click", unlock);
    document.addEventListener("touchstart", unlock);
    document.addEventListener("keydown", unlock);
    
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!socket || !roomId || !user) return;

    // Socket join-room is done in initializeRoom after audio setup

    // Listen for other participants
    socket.on("room-user-joined", handleUserJoined);
    socket.on("room-user-left", handleUserLeft);
    socket.on("room-participants", handleRoomParticipants);
    socket.on("user-speaking", handleUserSpeaking);

    return () => {
      socket.off("room-user-joined", handleUserJoined);
      socket.off("room-user-left", handleUserLeft);
      socket.off("room-participants", handleRoomParticipants);
      socket.off("user-speaking", handleUserSpeaking);
    };
  }, [socket, roomId, user]);

  // ─── GLOBAL signal listener — never misses ICE candidates ─────────────
  // Similar to CallManager, this is registered separately to ensure we always catch signals
  useEffect(() => {
    if (!socket) return;

    socket.on("room-signal", handleSignal);

    return () => {
      socket.off("room-signal", handleSignal);
    };
  }, [socket]);

  const handleUserSpeaking = (data: { userId: string; isSpeaking: boolean }) => {
    setParticipants(prev => {
      const updated = prev.map(p => p.userId === data.userId ? { ...p, isSpeaking: data.isSpeaking } : p);
      return updated;
    });
  };

  const joinRoomInDB = async () => {
    try {
      const response = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, userId: user?._id }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Failed to join room in DB:', data.message);
        // Continue anyway - Socket.IO will handle the connection
      }
    } catch (error) {
      console.error("Failed to join room in DB:", error);
      // Continue anyway - Socket.IO will handle the connection
    }
  };

  const fetchRoomDetails = async () => {
    try {
      const response = await fetch(`/api/rooms?roomId=${roomId}`);
      const data = await response.json();
      if (response.ok && data.rooms && data.rooms.length > 0) {
        setRoom(data.rooms[0]);
      } else {
        alert("Room not found");
        router.push("/dashboard/members");
      }
    } catch (error) {
      console.error("Failed to fetch room:", error);
      router.push("/dashboard/members");
    } finally {
      setLoading(false);
    }
  };

  const setupLocalAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      setLocalStream(stream);
      localStreamRef.current = stream;
      
      // Setup audio analyzer for local stream
      setupLocalAudioAnalyzer(stream);
      return stream;
    } catch (error) {
      console.error("Failed to get audio stream:", error);
      alert("Please enable microphone access to join voice chat");
      return null;
    }
  };

  const setupLocalAudioAnalyzer = (stream: MediaStream) => {
    if (!audioContext.current) {
      audioContext.current = new AudioContext();
    }

    // Resume AudioContext if suspended (browser autoplay policy)
    if (audioContext.current.state === 'suspended') {
      audioContext.current.resume();
    }

    try {
      const analyser = audioContext.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      
      const source = audioContext.current.createMediaStreamSource(stream);
      source.connect(analyser);
      
      localAnalyzer.current = analyser;
      detectSpeaking(analyser, user?._id || '');
    } catch (error) {
      console.error('Error setting up local audio analyzer:', error);
    }
  };

  const setupRemoteAudioAnalyzer = (stream: MediaStream, userId: string) => {
    if (!audioContext.current) {
      audioContext.current = new AudioContext();
    }

    const analyser = audioContext.current.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    
    try {
      const source = audioContext.current.createMediaStreamSource(stream);
      source.connect(analyser);
      
      audioAnalyzers.current.set(userId, analyser);
      detectSpeaking(analyser, userId);
    } catch (error) {
      console.error('Error setting up remote audio analyzer:', error);
    }
  };

  const detectSpeaking = (analyser: AnalyserNode, userId: string) => {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let lastSpeakingState = false;
    let frameCount = 0;
    let isRunning = true; // Track if analysis loop is still active
    
    console.log(`🎤 detectSpeaking STARTED for user ${userId}, bufferLength: ${bufferLength}`);
    
    const checkAudioLevel = () => {
      if (!isRunning) {
        console.log(`🎤 detectSpeaking STOPPED for user ${userId}`);
        return;
      }
      
      try {
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
        const max = Math.max(...Array.from(dataArray));
        
        // Log audio levels every 60 frames (~1 second at 60fps) for debugging
        frameCount++;
        if (frameCount % 60 === 0) {
          console.log(`🔊 [${userId}] Avg: ${average.toFixed(2)}, Max: ${max}`);
        }
        
        // Threshold for speaking detection - increased to reduce false positives
        const isSpeaking = average > 15;
        
        // Update only if state changed
        if (isSpeaking !== lastSpeakingState) {
          lastSpeakingState = isSpeaking;
          
          if (userId === user?._id) {
            setParticipants(prev => 
              prev.map(p => p.userId === user?._id ? { ...p, isSpeaking } : p)
            );
            
            if (socket && roomId) {
              socket.emit('user-speaking', { roomId, userId: user?._id, isSpeaking });
            }
          } else {
            setParticipants(prev => 
              prev.map(p => p.userId === userId ? { ...p, isSpeaking } : p)
            );
          }
        }
      } catch (error) {
        console.error('Error in speaking detection:', error);
        isRunning = false;
        return;
      }
      
      // Continue checking
      const frameId = requestAnimationFrame(checkAudioLevel);
      animationFrames.current.set(userId, frameId);
    };
    
    checkAudioLevel();
  };

  const handleRoomParticipants = (data: { participants: RoomParticipant[] }) => {
    // Add current user to participants list if not already present
    const currentUserInList = data.participants.find(p => p.userId === user?._id);
    const allParticipants = currentUserInList 
      ? data.participants 
      : [
          ...data.participants,
          {
            userId: user?._id || '',
            name: user?.name || '',
            avatar: user?.avatarConfig?.image || null,
            color: user?.avatarConfig?.color || '#27272a',
            isSpeaking: false,
          }
        ];
    
    setParticipants(allParticipants);
    
    // New user: create answerer connections for existing participants
    data.participants.forEach((participant) => {
      if (participant.userId !== user?._id && !peerConnectionsRef.current.has(participant.userId)) {
        createPeerConnection(participant.userId, false);
      }
    });
  };

  const handleUserJoined = (data: { userId: string; userName: string; avatar: string | null; color: string }) => {
    setParticipants((prev) => {
      if (prev.find(p => p.userId === data.userId)) return prev;
      return [...prev, { userId: data.userId, name: data.userName, avatar: data.avatar, color: data.color, isSpeaking: false }];
    });

    // Existing users: initiate offer to the newly joined user
    if (data.userId !== user?._id) {
      createPeerConnection(data.userId, true);
    }
  };

  const handleUserLeft = (data: { userId: string }) => {
    setParticipants((prev) => prev.filter(p => p.userId !== data.userId));
    
    // Clean up peer connection
    const pc = peerConnectionsRef.current.get(data.userId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(data.userId);
    }
    
    // Remove audio element
    const audio = audioRefs.current.get(data.userId);
    if (audio) {
      audio.srcObject = null;
      audioRefs.current.delete(data.userId);
    }

    // Clean up ICE candidate buffer
    iceCandidateBuffers.current.delete(data.userId);
  };

  // ─── Handle remote ICE candidate (buffer or add) ─────────────
  const handleRemoteIceCandidate = async (fromUserId: string, candidate: RTCIceCandidateInit) => {
    const pc = peerConnectionsRef.current.get(fromUserId);
    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error(`Error adding ICE candidate from ${fromUserId}:`, err);
      }
    } else {
      if (!iceCandidateBuffers.current.has(fromUserId)) {
        iceCandidateBuffers.current.set(fromUserId, []);
      }
      iceCandidateBuffers.current.get(fromUserId)!.push(candidate);
    }
  };

  // ─── Flush buffered ICE candidates into peer ─────────────────
  const flushIceCandidates = async (fromUserId: string, pc: RTCPeerConnection) => {
    const buffered = iceCandidateBuffers.current.get(fromUserId) || [];
    if (buffered.length === 0) return;

    iceCandidateBuffers.current.delete(fromUserId);
    
    for (const candidate of buffered) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("Error adding buffered ICE candidate:", err);
      }
    }
  };

  const createPeerConnection = async (targetUserId: string, initiator: boolean) => {
    const currentStream = localStreamRef.current;
    if (!currentStream || !socket) return;

    const existing = peerConnectionsRef.current.get(targetUserId);
    if (existing) return existing;

    const pc = new RTCPeerConnection(ICE_CONFIG);
    
    if (!iceCandidateBuffers.current.has(targetUserId)) {
      iceCandidateBuffers.current.set(targetUserId, []);
    }

    currentStream.getTracks().forEach((track) => {
      pc.addTrack(track, currentStream);
    });

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        console.log(`Connection established with ${targetUserId}`);
      } else if (pc.connectionState === 'failed') {
        console.error(`Connection failed with ${targetUserId}`);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        console.error(`ICE connection failed with ${targetUserId}`);
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`📤 Sending ICE candidate to ${targetUserId}:`, event.candidate.type);
        socket.emit("room-signal", {
          roomId,
          targetUserId,
          signal: { type: "ice-candidate", candidate: event.candidate },
        });
      } else {
        console.log(`✅ All ICE candidates sent to ${targetUserId}`);
      }
    };

    // Handle remote stream
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      let audio = audioRefs.current.get(targetUserId);
      
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audio.muted = false;
        audio.volume = 1.0;
        audioRefs.current.set(targetUserId, audio);
        
        audio.style.display = 'none';
        document.body.appendChild(audio);
      }
      
      audio.srcObject = remoteStream;
      
      audio.play().then(() => {
        // Audio playing successfully
      }).catch(err => {
        console.error(`Error playing audio for ${targetUserId}:`, err);
        // User interaction might be required for autoplay
      });
      
      // Setup audio analyzer for remote stream to detect speaking
      setupRemoteAudioAnalyzer(remoteStream, targetUserId);
    };

    peerConnectionsRef.current.set(targetUserId, pc);

    // If initiator, create and send offer
    if (initiator) {
      try {
        if (pc.signalingState !== "stable") {
          return pc;
        }
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false,
        });
        await pc.setLocalDescription(offer);
        socket.emit("room-signal", {
          roomId,
          targetUserId,
          signal: { type: "offer", sdp: offer },
        });
      } catch (error) {
        console.error("Failed to create offer:", error);
      }
    }

    return pc;
  };

  const handleSignal = async (data: { fromUserId: string; signal: any }) => {
    const { fromUserId, signal } = data;

    if (!socket) return;

    let pc = peerConnectionsRef.current.get(fromUserId);

    if (signal.type === "offer") {
      if (!pc) {
        pc = await createPeerConnection(fromUserId, false);
      }
      
      if (pc) {
        try {
          if (pc.signalingState !== "stable") {
            return;
          }
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          
          await flushIceCandidates(fromUserId, pc);
          
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          socket.emit("room-signal", {
            roomId,
            targetUserId: fromUserId,
            signal: { type: "answer", sdp: answer },
          });
        } catch (error) {
          console.error(`❌ Error handling offer from ${fromUserId}:`, error);
        }
      }
    } else if (signal.type === "answer") {
      if (pc) {
        try {
          if (pc.signalingState !== "have-local-offer") {
            return;
          }
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          
          await flushIceCandidates(fromUserId, pc);
        } catch (error) {
          console.error(`Error handling answer from ${fromUserId}:`, error);
        }
      }
    } else if (signal.type === "ice-candidate") {
      await handleRemoteIceCandidate(fromUserId, signal.candidate);
    }
  };

  const toggleMute = () => {
    const currentStream = localStreamRef.current;
    if (currentStream) {
      currentStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleDeafen = () => {
    audioRefs.current.forEach((audio) => {
      audio.muted = !isDeafened;
    });
    setIsDeafened(!isDeafened);
  };

  const leaveRoom = async () => {
    // Cleanup connections first
    cleanupConnections();
    
    // Emit socket leave event
    if (socket && roomId && user) {
      socket.emit("leave-room", { roomId, userId: user._id });
    }

    // Remove from DB participants
    try {
      await fetch("/api/rooms/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, userId: user?._id }),
      });
    } catch (error) {
      console.error("Failed to leave room:", error);
    }

    // Navigate back to members
    router.push("/dashboard/members");
  };

  const cleanupConnections = () => {
    // Close peer connections
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    
    // Stop all audio analyzers animation frames
    animationFrames.current.forEach((frameId) => {
      cancelAnimationFrame(frameId);
    });
    animationFrames.current.clear();
    
    // Clear audio analyzers
    audioAnalyzers.current.clear();
    localAnalyzer.current = null;
    
    // Close audio context
    if (audioContext.current) {
      audioContext.current.close();
      audioContext.current = null;
    }
    
    // Stop and remove audio elements
    audioRefs.current.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
      // Remove from document if it was added
      if (audio.parentNode) {
        audio.parentNode.removeChild(audio);
      }
    });
    audioRefs.current.clear();

    // Stop local stream
    const currentStream = localStreamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-white text-xl">Loading room...</div>
      </div>
    );
  }

  if (!room) {
    return null;
  }

  return (
    <div className="relative min-h-screen bg-zinc-950 p-6 md:p-8 font-dm overflow-hidden flex flex-col">
      {/* Dynamic Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[128px] mix-blend-screen" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-emerald-900/10 rounded-full blur-[128px] mix-blend-screen" />
      </div>

      <div className="relative z-10 w-full max-w-7xl mx-auto flex-1 flex flex-col">
        {/* Room Header */}
        <header className="flex items-start justify-between mb-8 sm:mb-12">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                <Volume2 className="w-5 h-5 text-emerald-500" />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{room.name}</h1>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] uppercase font-bold tracking-wider">
                Live
              </span>
            </div>
            {room.description && (
              <p className="text-zinc-400 text-sm max-w-md leading-relaxed ml-1">{room.description}</p>
            )}
          </div>
          
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-zinc-800 rounded-full">
            <div className="flex -space-x-2">
              {participants.slice(0, 3).map((p, i) => (
                <div key={i} className="w-6 h-6 rounded-full border-2 border-zinc-900 overflow-hidden bg-zinc-800">
                  {p.avatar && <img src={p.avatar} alt="" className="w-full h-full object-cover" />}
                </div>
              ))}
            </div>
            <span className="text-xs font-semibold text-zinc-400 pl-1">
              {participants.length} / {room.maxParticipants}
            </span>
          </div>
        </header>

        {/* Participants Grid */}
        <div 
          className="flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6 content-start pb-24"
          onClick={() => {
            if (audioContext.current && audioContext.current.state === 'suspended') {
              audioContext.current.resume();
            }
            audioRefs.current.forEach((audio) => {
              if (audio.muted) {
                audio.muted = false;
                audio.play().catch(() => {});
              }
            });
          }}
        >
          <AnimatePresence mode="popLayout">
            {participants.map((participant) => (
              <motion.div
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                key={participant.userId}
                className="group relative aspect-[3/4] rounded-3xl bg-zinc-900/40 backdrop-blur-sm border border-zinc-800/50 overflow-hidden flex flex-col items-center justify-center p-4 transition-all hover:bg-zinc-800/40 hover:border-zinc-700/50 hover:shadow-xl hover:shadow-black/20"
              >
                {/* Speaking Highlight */}
                {participant.isSpeaking && (
                  <div className="absolute inset-0 rounded-3xl border-2 border-emerald-500/50 shadow-[inset_0_0_20px_rgba(16,185,129,0.2)] transition-all duration-300" />
                )}

                <div className="relative mb-4">
                  <div className="relative z-10 w-20 h-20 md:w-24 md:h-24 rounded-full p-1 bg-gradient-to-b from-zinc-700 to-zinc-800 shadow-lg">
                    <div 
                      className="w-full h-full rounded-full overflow-hidden bg-zinc-900 flex items-center justify-center text-white"
                      style={{ backgroundColor: participant.color || "#27272a" }}
                    >
                      {participant.avatar ? (
                        <img
                          src={participant.avatar}
                          alt={participant.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl font-bold opacity-80">
                          {participant.name?.[0]?.toUpperCase() || "U"}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Status Indicator */}
                  {participant.isSpeaking && (
                     <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full border-4 border-zinc-900 flex items-center justify-center z-20 animate-pulse">
                        <Mic className="w-3 h-3 text-emerald-950" />
                     </div>
                  )}
                </div>

                <div className="text-center w-full relative z-10 px-2 space-y-1">
                  <h3 className="text-white font-semibold truncate text-sm md:text-base tracking-tight">
                    {participant.name}
                  </h3>
                  
                  {participant.userId === user?._id && (
                    <div className="inline-block px-2 py-0.5 rounded-full bg-zinc-800/80 border border-zinc-700 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      You
                    </div>
                  )}

                  {/* Audio Visualizer (Fake) */}
                  {participant.isSpeaking && (
                    <div className="flex items-center justify-center gap-0.5 h-3 mt-2">
                       {[...Array(5)].map((_, i) => (
                          <div 
                            key={i}
                            className="w-1 bg-emerald-500 rounded-full animate-music-bar"
                            style={{ 
                              animationDelay: `${i * 0.1}s`,
                              height: '100%' 
                            }} 
                          />
                       ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Floating Controls */}
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-fit px-4">
          <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800/50 p-2 rounded-2xl shadow-2xl flex items-center gap-2 md:gap-3 ring-1 ring-white/5">
            <button
              onClick={toggleMute}
              data-tooltip="Toggle Mute"
              className={`p-3.5 md:p-4 rounded-xl transition-all duration-200 group relative ${
                isMuted
                  ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                  : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {isMuted ? <MicOff className="w-5 h-5 md:w-6 md:h-6" /> : <Mic className="w-5 h-5 md:w-6 md:h-6" />}
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                {isMuted ? "Unmute" : "Mute"}
              </span>
            </button>

            <button
              onClick={toggleDeafen}
              className={`p-3.5 md:p-4 rounded-xl transition-all duration-200 group relative ${
                isDeafened
                  ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                  : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {isDeafened ? <VolumeX className="w-5 h-5 md:w-6 md:h-6" /> : <Volume2 className="w-5 h-5 md:w-6 md:h-6" />}
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                {isDeafened ? "Undeafen" : "Deafen"}
              </span>
            </button>

            <div className="w-px h-8 bg-zinc-800 mx-1 md:mx-2" />

            <button
              onClick={leaveRoom}
              className="p-3.5 md:p-4 rounded-xl bg-red-600 hover:bg-red-500 text-white transition-all shadow-lg shadow-red-900/20 group relative"
            >
              <PhoneOff className="w-5 h-5 md:w-6 md:h-6" />
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                Leave Room
              </span>
            </button>
            
            <div className="sm:hidden w-px h-8 bg-zinc-800 mx-1" />
            
            <div className="sm:hidden flex items-center justify-center w-10 h-10 rounded-xl bg-zinc-800/50 border border-zinc-700/50">
               <span className="text-xs font-bold text-zinc-400">{participants.length}</span>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes music-bar {
          0%, 100% { transform: scaleY(0.5); opacity: 0.5; }
          50% { transform: scaleY(1); opacity: 1; }
        }
        .animate-music-bar {
          animation: music-bar 0.5s ease-in-out infinite alternate;
        }
      `}</style>
    </div>
  );
}

