"use client";

import { useState, useEffect, useRef } from "react";
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
    
    // Create peer connections for existing participants (excluding self)
    data.participants.forEach((participant) => {
      if (participant.userId !== user?._id && !peerConnectionsRef.current.has(participant.userId)) {
        createPeerConnection(participant.userId, true);
      }
    });
  };

  const handleUserJoined = (data: { userId: string; userName: string; avatar: string | null; color: string }) => {
    setParticipants((prev) => {
      if (prev.find(p => p.userId === data.userId)) return prev;
      return [...prev, { userId: data.userId, name: data.userName, avatar: data.avatar, color: data.color, isSpeaking: false }];
    });

    // Create peer connection for new user (initiator)
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
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Room Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Volume2 className="w-8 h-8 text-emerald-500" />
            <h1 className="text-4xl font-bold text-white">{room.name}</h1>
          </div>
          {room.description && (
            <p className="text-zinc-400 ml-11">{room.description}</p>
          )}
        </div>

        {/* Participants Grid */}
        <div 
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 mb-8" 
          onClick={() => {
            // Resume AudioContext on user interaction (browser requirement)
            if (audioContext.current && audioContext.current.state === 'suspended') {
              audioContext.current.resume();
            }
            
            // Unmute audio elements (browser autoplay policy)
            audioRefs.current.forEach((audio) => {
              if (audio.muted) {
                audio.muted = false;
                audio.play().catch(() => {});
              }
            });
          }}
        >
          {participants.map((participant) => (
            <div
              key={participant.userId}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col items-center justify-center hover:border-zinc-700 transition-all relative"
            >
              {/* Speaking Indicator Pulse */}
              {participant.isSpeaking && (
                <>
                  <div className="absolute inset-0 rounded-2xl border-2 border-emerald-500/50" style={{animation: 'none'}}></div>
                  <div className="absolute inset-0 rounded-2xl bg-emerald-500/5" style={{animation: 'none'}}></div>
                </>
              )}
              
              <div className="relative">
                <div
                  className="w-24 h-24 rounded-full mb-4 flex items-center justify-center overflow-hidden transition-all relative"
                  style={{
                    backgroundColor: participant.color || "#27272a",
                    boxShadow: participant.isSpeaking 
                      ? `0 0 12px #10b98166`
                      : 'none',
                  }}
                >
                  {participant.avatar ? (
                    <img
                      src={participant.avatar}
                      alt={participant.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-3xl font-bold text-white">
                      {participant.name?.[0]?.toUpperCase() || "U"}
                    </span>
                  )}
                </div>
                
                {/* Soundwave Animation */}
                {participant.isSpeaking && (
                  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                    <div className="w-0.5 bg-emerald-500 rounded-full" style={{ height: '3px', animation: 'soundwave 0.6s ease-in-out infinite', animationDelay: '0s' }}></div>
                    <div className="w-0.5 bg-emerald-500 rounded-full" style={{ height: '5px', animation: 'soundwave 0.6s ease-in-out infinite', animationDelay: '0.1s' }}></div>
                    <div className="w-0.5 bg-emerald-500 rounded-full" style={{ height: '7px', animation: 'soundwave 0.6s ease-in-out infinite', animationDelay: '0.2s' }}></div>
                    <div className="w-0.5 bg-emerald-500 rounded-full" style={{ height: '5px', animation: 'soundwave 0.6s ease-in-out infinite', animationDelay: '0.3s' }}></div>
                    <div className="w-0.5 bg-emerald-500 rounded-full" style={{ height: '3px', animation: 'soundwave 0.6s ease-in-out infinite', animationDelay: '0.4s' }}></div>
                  </div>
                )}
              </div>
              
              <p className="text-white font-medium text-center truncate max-w-full">
                {participant.name}
              </p>
              {participant.userId === user?._id && (
                <span className="text-xs text-emerald-500 mt-1">(You)</span>
              )}
            </div>
          ))}
        </div>

        {/* Voice Controls */}
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-2xl">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleMute}
              className={`p-4 rounded-xl transition-all ${
                isMuted
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-zinc-800 hover:bg-zinc-700 text-white"
              }`}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>

            <button
              onClick={toggleDeafen}
              className={`p-4 rounded-xl transition-all ${
                isDeafened
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-zinc-800 hover:bg-zinc-700 text-white"
              }`}
            >
              {isDeafened ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </button>

            <div className="w-px h-10 bg-zinc-800 mx-2" />

            <button
              onClick={leaveRoom}
              className="p-4 rounded-xl bg-red-600 hover:bg-red-700 text-white transition-all"
            >
              <PhoneOff className="w-6 h-6" />
            </button>

            <div className="flex items-center gap-2 ml-4 px-4 py-2 bg-zinc-800 rounded-lg">
              <UsersIcon className="w-5 h-5 text-zinc-400" />
              <span className="text-white font-medium">
                {participants.length}/{room.maxParticipants}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
