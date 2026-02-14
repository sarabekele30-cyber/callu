"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useRouter, useParams } from "next/navigation";
import { Volume2, VolumeX, PhoneOff, Users as UsersIcon, Mic, MicOff, Video, VideoOff, MonitorUp, MonitorOff, PictureInPicture2, LayoutGrid, Maximize2 } from "lucide-react";
import { useSocket } from "@/context/SocketContext";
import { useCall } from "@/context/CallContext";

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
  isVideoOn: boolean;
  isScreenSharing: boolean;
}

export default function RoomVoiceChatPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const roomId = params?.roomId as string;
  const { socket } = useSocket();
  const { setIsInRoom, setCurrentRoomId, setCurrentRoomName } = useCall();

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isInPiP, setIsInPiP] = useState(false);
  const [layout, setLayout] = useState<'grid' | 'spotlight'>('grid');
  const [spotlightUserId, setSpotlightUserId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // Use ref for peer connections to avoid stale closure issues in socket callbacks
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioAnalyzers = useRef<Map<string, AnalyserNode>>(new Map());
  const localAnalyzer = useRef<AnalyserNode | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const animationFrames = useRef<Map<string, number>>(new Map());
  const iceCandidateBuffers = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const joinSoundBufferRef = useRef<AudioBuffer | null>(null);
  const leaveSoundBufferRef = useRef<AudioBuffer | null>(null);

  // Video & screen sharing refs
  const localVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const localVideoStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const remoteVideoStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const localVideoElRef = useRef<HTMLVideoElement>(null);
  const mixingCtxRef = useRef<AudioContext | null>(null);
  const originalMicTrackRef = useRef<MediaStreamTrack | null>(null);

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

  // Pre-load sound effects as AudioBuffers (bypasses autoplay restrictions)
  useEffect(() => {
    const ctx = audioContext.current || new AudioContext();
    if (!audioContext.current) audioContext.current = ctx;

    const loadSound = async (url: string): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return await ctx.decodeAudioData(arrayBuffer);
      } catch (err) {
        console.error(`Failed to load sound: ${url}`, err);
        return null;
      }
    };

    loadSound("/music/join_sound.mp3").then(buf => { joinSoundBufferRef.current = buf; });
    loadSound("/music/Leave_Sound.mp3").then(buf => { leaveSoundBufferRef.current = buf; });

    return () => {
      joinSoundBufferRef.current = null;
      leaveSoundBufferRef.current = null;
    };
  }, []);

  const playSoundBuffer = (buffer: AudioBuffer | null) => {
    if (!buffer || !audioContext.current) return;

    // Ensure AudioContext is running (it may get suspended by browser policy)
    if (audioContext.current.state === 'suspended') {
      audioContext.current.resume();
    }

    try {
      const source = audioContext.current.createBufferSource();
      const gainNode = audioContext.current.createGain();
      gainNode.gain.value = 0.5; // volume
      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(audioContext.current.destination);
      source.start(0);
    } catch (err) {
      console.error('Failed to play sound effect:', err);
    }
  };

  const playJoinSound = () => playSoundBuffer(joinSoundBufferRef.current);
  const playLeaveSound = () => playSoundBuffer(leaveSoundBufferRef.current);

  useEffect(() => {
    if (!user || !roomId) {
      router.push("/dashboard/members");
      return;
    }

    // If this page was loaded via browser refresh (no join intent flag), kick back to dashboard
    const joinIntent = sessionStorage.getItem('room-join-intent');
    if (!joinIntent) {
      router.replace("/dashboard/members");
      return;
    }
    sessionStorage.removeItem('room-join-intent');
    
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

      // Mark that we're in a room (for cross-feature conflict detection)
      setIsInRoom(true);
      setCurrentRoomId(roomId);
    };
    
    initializeRoom();

    // Handle tab/window close — use sendBeacon for reliable cleanup
    const handleBeforeUnload = () => {
      // sendBeacon is reliable during unload (unlike fetch)
      if (user && roomId) {
        navigator.sendBeacon(
          "/api/rooms/leave",
          new Blob([JSON.stringify({ roomId, userId: user._id })], { type: "application/json" })
        );
      }
      if (socket && roomId && user) {
        socket.emit("leave-room", { roomId, userId: user._id });
      }
      cleanupConnections();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      isActive = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);

      // Cleanup on unmount (e.g. navigating away, answering a call)
      cleanupConnections();
      if (socket && roomId && user) {
        socket.emit("leave-room", { roomId, userId: user._id });
      }
      // Fire-and-forget DB leave
      if (user && roomId) {
        fetch("/api/rooms/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, userId: user._id }),
          keepalive: true,
        }).catch(() => {});
      }
      // Clear room state
      setIsInRoom(false);
      setCurrentRoomId(null);
      setCurrentRoomName(null);
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

    // Video/screen share state from other participants
    const handleVideoToggle = (data: { userId: string; isVideoOn: boolean }) => {
      setParticipants(prev => prev.map(p => p.userId === data.userId ? { ...p, isVideoOn: data.isVideoOn } : p));
    };
    const handleScreenShare = (data: { userId: string; isSharing: boolean }) => {
      setParticipants(prev => prev.map(p => p.userId === data.userId ? { ...p, isScreenSharing: data.isSharing } : p));
      // Clear spotlight if sharer stopped sharing
      if (!data.isSharing) {
        setSpotlightUserId(prev => prev === data.userId ? null : prev);
      }
    };

    socket.on("room-video-toggle", handleVideoToggle);
    socket.on("room-screen-share", handleScreenShare);

    return () => {
      socket.off("room-user-joined", handleUserJoined);
      socket.off("room-user-left", handleUserLeft);
      socket.off("room-participants", handleRoomParticipants);
      socket.off("user-speaking", handleUserSpeaking);
      socket.off("room-video-toggle", handleVideoToggle);
      socket.off("room-screen-share", handleScreenShare);
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

  // ─── Synchronize local video stream with video element after render ─────
  // This is needed because toggleCamera/toggleScreenShare sets the stream ref
  // BEFORE setting isVideoOn state, so the video element doesn't exist yet
  // when srcObject is first assigned. This effect runs after re-render.
  useEffect(() => {
    const el = localVideoElRef.current;
    const stream = localVideoStreamRef.current;
    if (el && stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
        el.play().catch(() => {});
      }
    }
  }, [isVideoOn, isScreenSharing, layout]);

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
        setCurrentRoomName(data.rooms[0].name);
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
            isVideoOn: false,
            isScreenSharing: false,
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
      return [...prev, { userId: data.userId, name: data.userName, avatar: data.avatar, color: data.color, isSpeaking: false, isVideoOn: false, isScreenSharing: false }];
    });

    // Play join sound for other users joining
    if (data.userId !== user?._id) {
      playJoinSound();
      createPeerConnection(data.userId, true);
    }
  };

  const handleUserLeft = (data: { userId: string }) => {
    // Play leave sound
    playLeaveSound();
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

    // Clean up video refs
    remoteVideoStreamsRef.current.delete(data.userId);
    videoElementsRef.current.delete(data.userId);

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

    // Add audio tracks
    currentStream.getAudioTracks().forEach((track) => {
      pc.addTrack(track, currentStream);
    });

    // Video capability: BOTH sides need a video transceiver for video to work
    // Without this on both sides, the answerer can't send video back
    const localVideoTrack = localVideoTrackRef.current;
    if (localVideoTrack && localVideoStreamRef.current) {
      // We already have a video track (camera or screen share)
      pc.addTrack(localVideoTrack, localVideoStreamRef.current);
    } else {
      // No video yet — add transceiver so video m= line exists in SDP
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }

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
        socket.emit("room-signal", {
          roomId,
          targetUserId,
          signal: { type: "ice-candidate", candidate: event.candidate },
        });
      }
    };

    // Handle remote tracks (audio + video)
    pc.ontrack = (event) => {
      // event.streams[0] can be empty when addTransceiver was used without a stream
      const remoteStream = event.streams[0] || new MediaStream([event.track]);

      if (event.track.kind === 'audio') {
        // Audio: create/update audio element
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
        audio.play().catch(err => {
          console.error(`Error playing audio for ${targetUserId}:`, err);
        });
        
        setupRemoteAudioAnalyzer(remoteStream, targetUserId);
      } else if (event.track.kind === 'video') {
        // Video: store stream and attach to video element if it exists
        remoteVideoStreamsRef.current.set(targetUserId, remoteStream);
        const videoEl = videoElementsRef.current.get(targetUserId);
        if (videoEl) {
          videoEl.srcObject = remoteStream;
          videoEl.play().catch(() => {});
        }
      }
    };

    peerConnectionsRef.current.set(targetUserId, pc);

    // If initiator, create and send offer
    if (initiator) {
      try {
        if (pc.signalingState !== "stable") {
          return pc;
        }
        const offer = await pc.createOffer();
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

  const leaveRoom = () => {
    // Just navigate away — the useEffect cleanup handles socket leave,
    // DB leave, connection cleanup, and state clearing automatically.
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

    // Stop local video track
    if (localVideoTrackRef.current) {
      localVideoTrackRef.current.stop();
      localVideoTrackRef.current = null;
    }
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach(t => t.stop());
      localVideoStreamRef.current = null;
    }

    // Stop screen share
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    cameraTrackRef.current = null;
    originalMicTrackRef.current = null;

    // Close mixing context
    if (mixingCtxRef.current) {
      try { mixingCtxRef.current.close(); } catch {}
      mixingCtxRef.current = null;
    }

    // Clear remote video streams
    remoteVideoStreamsRef.current.clear();
    videoElementsRef.current.clear();

    // Exit PiP if active
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
  };

  // ─── Video ref callback — syncs video element with stored stream ─────
  const attachVideoRef = useCallback((userId: string, el: HTMLVideoElement | null) => {
    if (!el) {
      videoElementsRef.current.delete(userId);
      return;
    }
    videoElementsRef.current.set(userId, el);
    const stream = remoteVideoStreamsRef.current.get(userId);
    if (stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, []);

  // ─── Toggle Camera ──────────────────────────────────────────
  const toggleCamera = async () => {
    if (isVideoOn) {
      // Turn camera OFF
      // Replace video track with null on all peers
      for (const [, pc] of peerConnectionsRef.current) {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video' || (!s.track && pc.getTransceivers().find(t => t.sender === s && t.mid !== null)));
        if (videoSender) {
          await videoSender.replaceTrack(null);
        }
      }

      // Stop camera track
      if (localVideoTrackRef.current) {
        localVideoTrackRef.current.stop();
        localVideoTrackRef.current = null;
      }
      if (localVideoStreamRef.current) {
        localVideoStreamRef.current.getTracks().forEach(t => t.stop());
        localVideoStreamRef.current = null;
      }

      // Update local video element
      if (localVideoElRef.current) {
        localVideoElRef.current.srcObject = null;
      }

      setIsVideoOn(false);
      setParticipants(prev => prev.map(p => p.userId === user?._id ? { ...p, isVideoOn: false } : p));
      if (socket && roomId) {
        socket.emit("room-video-toggle", { roomId, userId: user?._id, isVideoOn: false });
      }
    } else {
      // Turn camera ON
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const videoTrack = cameraStream.getVideoTracks()[0];
        if (!videoTrack) return;

        localVideoTrackRef.current = videoTrack;
        localVideoStreamRef.current = cameraStream;

        // Replace track on all peer connections
        for (const [, pc] of peerConnectionsRef.current) {
          // Find the video sender (transceiver with video kind)
          const videoSender = pc.getSenders().find(s => {
            if (s.track?.kind === 'video') return true;
            // Check for a sender associated with a video transceiver but with null track
            const transceiver = pc.getTransceivers().find(t => t.sender === s && t.receiver.track?.kind === 'video');
            return !!transceiver;
          });
          if (videoSender) {
            await videoSender.replaceTrack(videoTrack);
          }
        }

        // Update local preview
        if (localVideoElRef.current) {
          localVideoElRef.current.srcObject = cameraStream;
          localVideoElRef.current.play().catch(() => {});
        }

        setIsVideoOn(true);
        setParticipants(prev => prev.map(p => p.userId === user?._id ? { ...p, isVideoOn: true } : p));
        if (socket && roomId) {
          socket.emit("room-video-toggle", { roomId, userId: user?._id, isVideoOn: true });
        }
      } catch (err) {
        console.error("Failed to get camera:", err);
        alert("Camera access denied or unavailable.");
      }
    }
  };

  // ─── Toggle Screen Share ────────────────────────────────────
  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      // START screen sharing
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: "always" } as MediaTrackConstraints,
          audio: true,
          systemAudio: "include",
        } as DisplayMediaStreamOptions);

        const screenTrack = screenStream.getVideoTracks()[0];
        if (!screenTrack) return;

        // Save camera track if we have one
        cameraTrackRef.current = localVideoTrackRef.current;

        // Replace video track on ALL peer connections
        for (const [, pc] of peerConnectionsRef.current) {
          const videoSender = pc.getSenders().find(s => {
            if (s.track?.kind === 'video') return true;
            const transceiver = pc.getTransceivers().find(t => t.sender === s && t.receiver.track?.kind === 'video');
            return !!transceiver;
          });
          if (videoSender) {
            await videoSender.replaceTrack(screenTrack);
          }
        }

        // Handle screen audio + mic mixing
        const screenAudioTracks = screenStream.getAudioTracks();
        if (screenAudioTracks.length > 0) {
          const micTrack = localStreamRef.current?.getAudioTracks()[0] || null;
          if (micTrack) originalMicTrackRef.current = micTrack;

          const mixCtx = new AudioContext();
          mixingCtxRef.current = mixCtx;
          const destination = mixCtx.createMediaStreamDestination();

          // Screen audio
          const screenAudioStream = new MediaStream(screenAudioTracks);
          const screenSource = mixCtx.createMediaStreamSource(screenAudioStream);
          const screenGain = mixCtx.createGain();
          screenGain.gain.value = 0.7;
          screenSource.connect(screenGain).connect(destination);

          // Mic audio
          if (micTrack) {
            const micStream = new MediaStream([micTrack]);
            const micSource = mixCtx.createMediaStreamSource(micStream);
            const micGain = mixCtx.createGain();
            micGain.gain.value = 1.0;
            micSource.connect(micGain).connect(destination);
          }

          // Send mixed audio to all peers
          const mixedTrack = destination.stream.getAudioTracks()[0];
          if (mixedTrack) {
            for (const [, pc] of peerConnectionsRef.current) {
              const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
              if (audioSender) {
                await audioSender.replaceTrack(mixedTrack);
              }
            }
          }
        }

        screenStreamRef.current = screenStream;
        localVideoTrackRef.current = screenTrack;
        localVideoStreamRef.current = screenStream;

        // Update local preview
        if (localVideoElRef.current) {
          localVideoElRef.current.srcObject = new MediaStream([screenTrack]);
          localVideoElRef.current.play().catch(() => {});
        }

        setIsScreenSharing(true);
        setIsVideoOn(true);
        setParticipants(prev => prev.map(p => p.userId === user?._id ? { ...p, isVideoOn: true, isScreenSharing: true } : p));
        if (socket && roomId) {
          socket.emit("room-video-toggle", { roomId, userId: user?._id, isVideoOn: true });
          socket.emit("room-screen-share", { roomId, userId: user?._id, isSharing: true });
        }

        // Listen for native "Stop sharing" button
        screenTrack.onended = () => {
          void stopScreenShare();
        };
      } catch (err) {
        console.log("Screen share cancelled or failed:", err);
      }
    } else {
      await stopScreenShare();
    }
  };

  const stopScreenShare = async () => {
    // Stop screen tracks
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }

    // Restore original mic track (undo audio mixing)
    const savedMicTrack = originalMicTrackRef.current;
    for (const [, pc] of peerConnectionsRef.current) {
      const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (audioSender) {
        if (savedMicTrack && savedMicTrack.readyState === 'live') {
          await audioSender.replaceTrack(savedMicTrack);
        } else {
          const fallback = localStreamRef.current?.getAudioTracks()[0] || null;
          if (fallback && fallback.readyState === 'live') {
            await audioSender.replaceTrack(fallback);
          }
        }
      }
    }
    originalMicTrackRef.current = null;

    // Close mixing context
    if (mixingCtxRef.current) {
      try { await mixingCtxRef.current.close(); } catch {}
      mixingCtxRef.current = null;
    }

    // Restore camera track or remove video
    const cameraTrack = cameraTrackRef.current;
    if (cameraTrack && cameraTrack.readyState === 'live') {
      // Restore camera
      localVideoTrackRef.current = cameraTrack;
      for (const [, pc] of peerConnectionsRef.current) {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video' || pc.getTransceivers().find(t => t.sender === s && t.receiver.track?.kind === 'video'));
        if (videoSender) {
          await videoSender.replaceTrack(cameraTrack);
        }
      }
      if (localVideoElRef.current && localVideoStreamRef.current) {
        localVideoElRef.current.srcObject = localVideoStreamRef.current;
      }
      setIsVideoOn(true);
    } else {
      // No camera was on, turn off video
      for (const [, pc] of peerConnectionsRef.current) {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(null);
        }
      }
      localVideoTrackRef.current = null;
      localVideoStreamRef.current = null;
      if (localVideoElRef.current) localVideoElRef.current.srcObject = null;
      setIsVideoOn(false);
      setParticipants(prev => prev.map(p => p.userId === user?._id ? { ...p, isVideoOn: false } : p));
      if (socket && roomId) {
        socket.emit("room-video-toggle", { roomId, userId: user?._id, isVideoOn: false });
      }
    }
    cameraTrackRef.current = null;

    setIsScreenSharing(false);
    setParticipants(prev => prev.map(p => p.userId === user?._id ? { ...p, isScreenSharing: false } : p));
    if (socket && roomId) {
      socket.emit("room-screen-share", { roomId, userId: user?._id, isSharing: false });
    }
  };

  // ─── Picture-in-Picture ──────────────────────────────────────
  const togglePiP = async () => {
    if (isInPiP) {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
      setIsInPiP(false);
    } else {
      // PiP the spotlight user's video, or first video-on participant
      const targetId = spotlightUserId || participants.find(p => p.isVideoOn && p.userId !== user?._id)?.userId;
      if (targetId) {
        const videoEl = videoElementsRef.current.get(targetId);
        if (videoEl && document.pictureInPictureEnabled) {
          try {
            await videoEl.requestPictureInPicture();
            setIsInPiP(true);
          } catch (err) {
            console.error("PiP failed:", err);
          }
        }
      }
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
          
          <div className="hidden sm:flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-zinc-800 rounded-full">
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
          </div>
        </header>

        {/* ─── SPOTLIGHT LAYOUT ─── */}
        {layout === 'spotlight' ? (
          <div className="flex-1 flex flex-col pb-24 gap-4">
            {/* Main spotlight area */}
            <div className="flex-1 relative rounded-3xl overflow-hidden bg-zinc-900/40 border border-zinc-800/50 min-h-[300px]">
              {(() => {
                const sp = spotlightUserId ? participants.find(p => p.userId === spotlightUserId) : participants.find(p => p.isVideoOn || p.isScreenSharing) || participants[0];
                if (!sp) return null;
                const isLocal = sp.userId === user?._id;
                return (
                  <>
                    {sp.isVideoOn ? (
                      isLocal ? (
                        <video
                          ref={localVideoElRef}
                          autoPlay
                          playsInline
                          muted
                          className="absolute inset-0 w-full h-full object-contain bg-black"
                          style={!isScreenSharing ? { transform: "scaleX(-1)" } : undefined}
                        />
                      ) : (
                        <video
                          ref={(el) => attachVideoRef(sp.userId, el)}
                          autoPlay
                          playsInline
                          muted
                          className="absolute inset-0 w-full h-full object-contain bg-black"
                        />
                      )
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="w-32 h-32 rounded-full overflow-hidden mb-4" style={{ backgroundColor: sp.color || '#27272a' }}>
                          {sp.avatar ? (
                            <img src={sp.avatar} alt={sp.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white text-5xl font-bold opacity-80">
                              {sp.name?.[0]?.toUpperCase() || 'U'}
                            </div>
                          )}
                        </div>
                        <h3 className="text-white text-xl font-semibold">{sp.name}</h3>
                      </div>
                    )}
                    {/* Overlay info */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4 z-20">
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-medium">{sp.name}</h3>
                        {sp.userId === user?._id && <span className="text-[10px] text-zinc-400 bg-zinc-800/80 px-1.5 py-0.5 rounded uppercase">You</span>}
                        {sp.isScreenSharing && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                            <MonitorUp className="w-3 h-3" /> Sharing
                          </span>
                        )}
                        {sp.isSpeaking && (
                          <div className="flex items-center gap-0.5 ml-1">
                            {[0, 0.1, 0.2].map((d, i) => (
                              <span key={i} className="w-0.5 bg-emerald-400 rounded-full" style={{ height: i === 1 ? '6px' : '4px', animation: 'soundwave 0.6s ease-in-out infinite', animationDelay: `${d}s` }} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Speaking border */}
                    {sp.isSpeaking && <div className="absolute inset-0 rounded-3xl border-2 border-emerald-500/50 z-30 pointer-events-none" />}
                  </>
                );
              })()}
            </div>

            {/* Bottom strip — other participants */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {participants.filter(p => p.userId !== (spotlightUserId || participants.find(s => s.isVideoOn || s.isScreenSharing)?.userId || participants[0]?.userId)).map((p) => (
                <div
                  key={p.userId}
                  onClick={() => setSpotlightUserId(p.userId)}
                  className={`relative flex-shrink-0 w-28 h-28 rounded-2xl overflow-hidden bg-zinc-900/60 border cursor-pointer transition-all hover:border-zinc-600 ${
                    p.isSpeaking ? 'border-emerald-500/50' : 'border-zinc-800/50'
                  }`}
                >
                  {p.isVideoOn ? (
                    p.userId === user?._id ? (
                      <video ref={!spotlightUserId || spotlightUserId !== user?._id ? localVideoElRef : undefined} autoPlay playsInline muted className="w-full h-full object-cover" style={!isScreenSharing ? { transform: "scaleX(-1)" } : undefined} />
                    ) : (
                      <video ref={(el) => attachVideoRef(p.userId, el)} autoPlay playsInline muted className="w-full h-full object-cover" />
                    )
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center" style={{ backgroundColor: p.color || '#27272a' }}>
                      {p.avatar ? (
                        <img src={p.avatar} alt={p.name} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <span className="text-white text-lg font-bold opacity-80">{p.name?.[0]?.toUpperCase()}</span>
                      )}
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                    <span className="text-white text-[10px] font-medium truncate block">{p.name}</span>
                  </div>
                  {p.isScreenSharing && (
                    <div className="absolute top-1 right-1 bg-emerald-500/20 rounded p-0.5">
                      <MonitorUp className="w-2.5 h-2.5 text-emerald-400" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ─── GRID LAYOUT ─── */
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
                  className={`group relative rounded-3xl bg-zinc-900/40 backdrop-blur-sm border border-zinc-800/50 overflow-hidden flex flex-col items-center justify-center transition-all hover:bg-zinc-800/40 hover:border-zinc-700/50 hover:shadow-xl hover:shadow-black/20 ${
                    participant.isVideoOn ? 'aspect-video' : 'aspect-[3/4]'
                  }`}
                >
                  {/* Video — shown when participant has video on */}
                  {participant.isVideoOn ? (
                    <>
                      {participant.userId === user?._id ? (
                        <video
                          ref={localVideoElRef}
                          autoPlay
                          playsInline
                          muted
                          className="absolute inset-0 w-full h-full object-cover z-10"
                          style={!isScreenSharing ? { transform: "scaleX(-1)" } : undefined}
                        />
                      ) : (
                        <video
                          ref={(el) => attachVideoRef(participant.userId, el)}
                          autoPlay
                          playsInline
                          muted
                          className="absolute inset-0 w-full h-full object-cover z-10"
                        />
                      )}
                      {/* Overlay bar */}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 z-20">
                        <div className="flex items-center gap-2">
                          <h3 className="text-white text-xs font-medium truncate">{participant.name}</h3>
                          {participant.userId === user?._id && <span className="text-[9px] text-zinc-400 bg-zinc-800/80 px-1 py-0.5 rounded uppercase">You</span>}
                          {participant.isScreenSharing && <MonitorUp className="w-3 h-3 text-emerald-400" />}
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Avatar fallback */
                    <>
                      <div className="relative mb-4 p-4">
                        <div className="relative z-10 w-20 h-20 md:w-24 md:h-24 rounded-full p-1 bg-gradient-to-b from-zinc-700 to-zinc-800 shadow-lg">
                          <div 
                            className="w-full h-full rounded-full overflow-hidden bg-zinc-900 flex items-center justify-center text-white"
                            style={{ backgroundColor: participant.color || "#27272a" }}
                          >
                            {participant.avatar ? (
                              <img src={participant.avatar} alt={participant.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-2xl font-bold opacity-80">
                                {participant.name?.[0]?.toUpperCase() || "U"}
                              </span>
                            )}
                          </div>
                        </div>
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
                        {participant.isSpeaking && (
                          <div className="flex items-center justify-center gap-0.5 h-3 mt-2">
                            {[...Array(5)].map((_, i) => (
                              <div key={i} className="w-1 bg-emerald-500 rounded-full animate-music-bar" style={{ animationDelay: `${i * 0.1}s`, height: '100%' }} />
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Speaking border (both modes) */}
                  {participant.isSpeaking && (
                    <div className="absolute inset-0 rounded-3xl border-2 border-emerald-500/50 shadow-[inset_0_0_20px_rgba(16,185,129,0.2)] z-30 pointer-events-none" />
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* ─── Floating Controls ─── */}
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-fit px-4">
          <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800/50 p-2 rounded-2xl shadow-2xl flex items-center gap-1.5 md:gap-2 ring-1 ring-white/5">
            {/* Mic */}
            <button
              onClick={toggleMute}
              className={`p-3 md:p-3.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                isMuted ? "bg-red-500/10 text-red-500 hover:bg-red-500/20" : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                {isMuted ? "Unmute" : "Mute"}
              </span>
            </button>

            {/* Deafen */}
            <button
              onClick={toggleDeafen}
              className={`p-3 md:p-3.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                isDeafened ? "bg-red-500/10 text-red-500 hover:bg-red-500/20" : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {isDeafened ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                {isDeafened ? "Undeafen" : "Deafen"}
              </span>
            </button>

            <div className="w-px h-8 bg-zinc-800" />

            {/* Camera */}
            <button
              onClick={() => void toggleCamera()}
              className={`p-3 md:p-3.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                isVideoOn && !isScreenSharing ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {isVideoOn && !isScreenSharing ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                {isVideoOn && !isScreenSharing ? "Camera Off" : "Camera On"}
              </span>
            </button>

            {/* Screen Share */}
            <button
              onClick={() => void toggleScreenShare()}
              className={`p-3 md:p-3.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                isScreenSharing ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <MonitorUp className="w-5 h-5" />}
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                {isScreenSharing ? "Stop Sharing" : "Share Screen"}
              </span>
            </button>

            {/* PiP */}
            {participants.some(p => p.isVideoOn && p.userId !== user?._id) && (
              <button
                onClick={() => void togglePiP()}
                className={`p-3 md:p-3.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                  isInPiP ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20" : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                }`}
              >
                <PictureInPicture2 className="w-5 h-5" />
                <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                  {isInPiP ? "Exit PiP" : "Picture-in-Picture"}
                </span>
              </button>
            )}

            <div className="w-px h-8 bg-zinc-800" />

            {/* Layout toggle (hidden on mobile) */}
            <button
              onClick={() => setLayout(l => l === 'grid' ? 'spotlight' : 'grid')}
              className="hidden sm:block p-3 md:p-3.5 rounded-xl bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-all duration-200 group relative cursor-pointer"
            >
              {layout === 'grid' ? <Maximize2 className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                {layout === 'grid' ? 'Spotlight' : 'Grid'}
              </span>
            </button>

            <div className="w-px h-8 bg-zinc-800" />

            {/* Leave */}
            <button
              onClick={leaveRoom}
              className="p-3 md:p-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white transition-all shadow-lg shadow-red-900/20 group relative cursor-pointer"
            >
              <PhoneOff className="w-5 h-5" />
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                Leave Room
              </span>
            </button>

            {/* Mobile participant count */}
            <div className="sm:hidden flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-800/50 border border-zinc-700/50">
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
        @keyframes soundwave {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1.2); }
        }
      `}</style>
    </div>
  );
}

