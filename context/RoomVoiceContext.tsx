"use client";

import React, { createContext, useContext, useState, useRef, useEffect, MutableRefObject } from "react";
import { useAuth } from "./AuthContext";
import { useSocket } from "./SocketContext";
import { useCall } from "./CallContext";
import { toast } from "sonner";

export interface RoomParticipant {
  userId: string;
  name: string;
  avatar: string | null;
  color: string;
  isSpeaking: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  isMuted?: boolean;
}

interface RoomVoiceContextType {
  isVoiceConnected: boolean;
  voiceRoomId: string | null;
  voiceRoomName: string | null;
  participants: RoomParticipant[];
  setParticipants: React.Dispatch<React.SetStateAction<RoomParticipant[]>>;
  isMuted: boolean;
  isDeafened: boolean;
  availableMics: MediaDeviceInfo[];
  availableSpeakers: MediaDeviceInfo[];
  selectedMicId: string | null;
  selectedSpeakerId: string | null;
  switchMicDevice: (deviceId: string) => Promise<void>;
  setSpeakerDevice: (deviceId: string) => Promise<void>;
  joinVoice: (roomId: string, roomName: string) => Promise<boolean>;
  leaveVoice: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  peerConnectionsRef: MutableRefObject<Map<string, RTCPeerConnection>>;
  remoteVideoStreamsRef: MutableRefObject<Map<string, MediaStream>>;
  videoElementsRef: MutableRefObject<Map<string, HTMLVideoElement>>;
  localStreamRef: MutableRefObject<MediaStream | null>;
  localVideoTrackRef: MutableRefObject<MediaStreamTrack | null>;
  localVideoStreamRef: MutableRefObject<MediaStream | null>;
}

const RoomVoiceContext = createContext<RoomVoiceContextType>({
  isVoiceConnected: false,
  voiceRoomId: null,
  voiceRoomName: null,
  participants: [],
  setParticipants: () => {},
  isMuted: false,
  isDeafened: false,
  availableMics: [],
  availableSpeakers: [],
  selectedMicId: null,
  selectedSpeakerId: null,
  switchMicDevice: async () => {},
  setSpeakerDevice: async () => {},
  joinVoice: async () => false,
  leaveVoice: () => {},
  toggleMute: () => {},
  toggleDeafen: () => {},
  peerConnectionsRef: { current: new Map() },
  remoteVideoStreamsRef: { current: new Map() },
  videoElementsRef: { current: new Map() },
  localStreamRef: { current: null },
  localVideoTrackRef: { current: null },
  localVideoStreamRef: { current: null },
});

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

const optimizeSDP = (sdp: string): string => {
  if (!sdp) return sdp;
  
  // 1. Force stereo, FEC (Forward Error Correction), and high bitrate (128kbps) for Opus audio codec
  let optimized = sdp.replace(
    /a=fmtp:(\d+) useinbandfec=1/g,
    "a=fmtp:$1 useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000;minptime=10;ptime=20"
  );
  
  // 2. Set interactive high priority for audio line
  if (optimized.includes("a=mid:audio")) {
    optimized = optimized.replace("a=mid:audio", "a=mid:audio\r\na=priority:high\r\na=extmap-allow-mixed");
  }
  
  // 3. Set high priority for video line to ensure no packet drops or latency under heavy loads
  if (optimized.includes("a=mid:video")) {
    optimized = optimized.replace("a=mid:video", "a=mid:video\r\na=priority:high");
  }
  
  return optimized;
};

export const RoomVoiceProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { setIsInRoom, setCurrentRoomId, setCurrentRoomName } = useCall();

  // ─── Reactive state ─────────────────────────────────────────────
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [voiceRoomId, setVoiceRoomId] = useState<string | null>(null);
  const [voiceRoomName, setVoiceRoomName] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [availableSpeakers, setAvailableSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string | null>(null);
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string | null>(null);

  // ─── Stable refs for handler closures (avoid stale captures) ────
  const voiceRoomIdRef = useRef<string | null>(null);
  const userRef = useRef(user);
  const socketRef = useRef(socket);
  const isMutedRef = useRef(false);
  const isDeafenedRef = useRef(false);
  const isVoiceConnectedRef = useRef(false);
  const selectedSpeakerIdRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isDeafenedRef.current = isDeafened; }, [isDeafened]);
  useEffect(() => { isVoiceConnectedRef.current = isVoiceConnected; }, [isVoiceConnected]);
  useEffect(() => { selectedSpeakerIdRef.current = selectedSpeakerId; }, [selectedSpeakerId]);

  // ─── Voice infrastructure refs ──────────────────────────────────
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioAnalyzers = useRef<Map<string, AnalyserNode>>(new Map());
  const localAnalyzer = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animationFrames = useRef<Map<string, number>>(new Map());
  const iceCandidateBuffers = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const joinSoundBufferRef = useRef<AudioBuffer | null>(null);
  const leaveSoundBufferRef = useRef<AudioBuffer | null>(null);
  const speakingFlags = useRef<Map<string, { running: boolean }>>(new Map());

  // ─── Video refs (shared with room page) ─────────────────────────
  const localVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const localVideoStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Socket listener refs for cleanup
  const socketListenersRef = useRef<Record<string, (...args: any[]) => void> | null>(null);

  // ─── Pre-load sound effects ─────────────────────────────────────
  useEffect(() => {
    const ctx = audioCtxRef.current || new AudioContext();
    if (!audioCtxRef.current) audioCtxRef.current = ctx;

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
  }, []);

  // ─── Audio unlock on first user interaction ─────────────────────
  useEffect(() => {
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      if (audioCtxRef.current?.state === "suspended") {
        audioCtxRef.current.resume();
      }
      audioRefs.current.forEach((audio) => {
        if (!isDeafenedRef.current) {
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
    void refreshDeviceLists();
    const handler = () => {
      void refreshDeviceLists();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════

  const refreshDeviceLists = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === "audioinput");
      const speakers = devices.filter((d) => d.kind === "audiooutput");
      setAvailableMics(mics);
      setAvailableSpeakers(speakers);

      if (mics.length > 0) {
        const hasSelected = selectedMicId && mics.some((d) => d.deviceId === selectedMicId);
        if (!hasSelected) setSelectedMicId(mics[0].deviceId);
      }

      if (speakers.length > 0) {
        const hasSelected = selectedSpeakerId && speakers.some((d) => d.deviceId === selectedSpeakerId);
        if (!hasSelected) {
          const defaultSpeaker = speakers.find((d) => d.deviceId === "default")?.deviceId || speakers[0].deviceId;
          setSelectedSpeakerId(defaultSpeaker);
        }
      }
    } catch (err) {
      console.error("Failed to enumerate devices:", err);
    }
  };

  const applySpeakerToAudio = async (audioEl: HTMLAudioElement, deviceId: string) => {
    const sinkCapable = (audioEl as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
    if (typeof sinkCapable !== "function") return;
    try {
      await (audioEl as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId);
    } catch (err) {
      console.error("Failed to set speaker device:", err);
    }
  };

  const setSpeakerDevice = async (deviceId: string) => {
    setSelectedSpeakerId(deviceId);
    const audios = Array.from(audioRefs.current.values());
    await Promise.all(audios.map((audio) => applySpeakerToAudio(audio, deviceId)));
  };

  useEffect(() => {
    if (!selectedSpeakerId) return;
    const audios = Array.from(audioRefs.current.values());
    audios.forEach((audio) => {
      applySpeakerToAudio(audio, selectedSpeakerId).catch(() => {});
    });
  }, [selectedSpeakerId]);
  //  Cleanup (must be declared before effects that use it)
  // ═══════════════════════════════════════════════════════════════

  const cleanupConnections = () => {
    // Close peer connections
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();

    // Stop speaking detection
    speakingFlags.current.forEach(flag => { flag.running = false; });
    speakingFlags.current.clear();
    animationFrames.current.forEach((timerId) => clearTimeout(timerId));
    animationFrames.current.clear();

    // Clear analyzers
    audioAnalyzers.current.clear();
    localAnalyzer.current = null;

    // Stop and remove audio elements
    audioRefs.current.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
      if (audio.parentNode) audio.parentNode.removeChild(audio);
    });
    audioRefs.current.clear();

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Stop video tracks
    if (localVideoTrackRef.current) {
      localVideoTrackRef.current.stop();
      localVideoTrackRef.current = null;
    }
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach(t => t.stop());
      localVideoStreamRef.current = null;
    }

    // Clear video refs
    remoteVideoStreamsRef.current.clear();
    videoElementsRef.current.clear();

    // Clear ICE buffers
    iceCandidateBuffers.current.clear();

    // Exit PiP if active
    if (typeof document !== "undefined" && document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }

    // Note: AudioContext is intentionally NOT closed — reused across join/leave cycles
  };

  // ─── Handle tab/window close ────────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!isVoiceConnectedRef.current) return;
      const rid = voiceRoomIdRef.current;
      const u = userRef.current;
      const s = socketRef.current;
      if (u && rid) {
        navigator.sendBeacon(
          "/api/rooms/leave",
          new Blob([JSON.stringify({ roomId: rid, userId: u._id })], { type: "application/json" })
        );
      }
      if (s && rid && u) {
        s.emit("leave-room", { roomId: rid, userId: u._id });
      }
      cleanupConnections();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // ═══════════════════════════════════════════════════════════════
  //  Sound playback
  // ═══════════════════════════════════════════════════════════════

  const playSoundBuffer = (buffer: AudioBuffer | null) => {
    if (!buffer || !audioCtxRef.current) return;
    if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
    try {
      const source = audioCtxRef.current.createBufferSource();
      const gainNode = audioCtxRef.current.createGain();
      gainNode.gain.value = 0.5;
      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(audioCtxRef.current.destination);
      source.start(0);
    } catch (err) {
      console.error("Failed to play sound:", err);
    }
  };

  const playJoinSound = () => playSoundBuffer(joinSoundBufferRef.current);
  const playLeaveSound = () => playSoundBuffer(leaveSoundBufferRef.current);

  // ═══════════════════════════════════════════════════════════════
  //  Audio setup & speaking detection
  // ═══════════════════════════════════════════════════════════════

  const setupLocalAudio = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 }, // Higher quality audio (48kHz)
        },
      });
      localStreamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      if (track) {
        track.enabled = !isMutedRef.current;
      }
      setupLocalAudioAnalyzer(stream);
      void refreshDeviceLists();
      return stream;
    } catch (error) {
      console.error("Failed to get audio stream:", error);
      toast.error("Please enable microphone access to join voice chat");
      return null;
    }
  };

  const switchMicDevice = async (deviceId: string) => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: { ideal: 48000 } },
      });
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;
      newTrack.enabled = !isMutedRef.current;

      peerConnectionsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
        if (sender) sender.replaceTrack(newTrack).catch(() => {});
      });

      const prev = localStreamRef.current;
      if (prev) prev.getAudioTracks().forEach((t) => t.stop());
      localStreamRef.current = newStream;
      setupLocalAudioAnalyzer(newStream);
      setSelectedMicId(deviceId);
    } catch (err) {
      console.error("Failed to switch microphone:", err);
      toast.error("Failed to switch microphone");
    }
  };

  const setupLocalAudioAnalyzer = (stream: MediaStream) => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
    try {
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      source.connect(analyser);
      localAnalyzer.current = analyser;
      const u = userRef.current;
      if (u) detectSpeaking(analyser, u._id);
    } catch (error) {
      console.error("Error setting up local audio analyzer:", error);
    }
  };

  const setupRemoteAudioAnalyzer = (stream: MediaStream, userId: string) => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    try {
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      source.connect(analyser);
      audioAnalyzers.current.set(userId, analyser);
      detectSpeaking(analyser, userId);
    } catch (error) {
      console.error("Error setting up remote audio analyzer:", error);
    }
  };

  const detectSpeaking = (analyser: AnalyserNode, userId: string) => {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let lastSpeakingState = false;
    const flag = { running: true };
    // Stop any existing detection for this user
    const oldFlag = speakingFlags.current.get(userId);
    if (oldFlag) oldFlag.running = false;
    speakingFlags.current.set(userId, flag);

    const checkAudioLevel = () => {
      if (!flag.running) return;
      try {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
        const isSpeaking = average > 15;

        if (isSpeaking !== lastSpeakingState) {
          lastSpeakingState = isSpeaking;
          const u = userRef.current;
          const s = socketRef.current;
          const rid = voiceRoomIdRef.current;

          if (userId === u?._id) {
            setParticipants(prev => prev.map(p => p.userId === u?._id ? { ...p, isSpeaking } : p));
            if (s && rid) s.emit("user-speaking", { roomId: rid, userId: u._id, isSpeaking });
          } else {
            setParticipants(prev => prev.map(p => p.userId === userId ? { ...p, isSpeaking } : p));
          }
        }
      } catch {
        flag.running = false;
        return;
      }
      const frameId = setTimeout(checkAudioLevel, 100);
      animationFrames.current.set(userId, frameId as any);
    };
    checkAudioLevel();
  };

  // ═══════════════════════════════════════════════════════════════
  //  WebRTC peer connection management
  // ═══════════════════════════════════════════════════════════════

  const createPeerConnection = async (targetUserId: string, initiator: boolean): Promise<RTCPeerConnection | undefined> => {
    const currentStream = localStreamRef.current;
    const s = socketRef.current;
    const rid = voiceRoomIdRef.current;
    if (!currentStream || !s || !rid) return;

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

    // Video: add existing track or empty transceiver placeholder
    const localVidTrack = localVideoTrackRef.current;
    if (localVidTrack && localVideoStreamRef.current) {
      pc.addTrack(localVidTrack, localVideoStreamRef.current);
    } else {
      pc.addTransceiver("video", { direction: "sendrecv" });
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        console.log(`✅ Connected with ${targetUserId}`);
        // Set maximum bitrate for video and audio
        pc.getSenders().forEach((sender) => {
          if (sender.track?.kind === "video") {
            console.log(`📹 Video encoder allocated: max 5 Mbps to ${targetUserId}`);
          } else if (sender.track?.kind === "audio") {
            console.log(`🔊 Audio encoder allocated: max 500 kbps to ${targetUserId}`);
          }
        });
      } else if (pc.connectionState === "failed") {
        console.error(`❌ Connection failed with ${targetUserId}`);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        // Allocate maximum bandwidth when ICE is connected
        const allocateBandwidth = async () => {
          try {
            const senders = pc.getSenders();
            for (const sender of senders) {
              if (!sender.track) continue;
              const params = sender.getParameters();
              
              // Initialize encodings array if not present
              if (!params.encodings) {
                params.encodings = [{}];
              }
              
              if (sender.track.kind === "video") {
                // Allocate 5 Mbps for video (screen share gets priority)
                params.encodings[0].maxBitrate = 5_000_000;
                params.encodings[0].maxFramerate = 60; // Support up to 60 FPS
              } else if (sender.track.kind === "audio") {
                // Allocate 500 kbps for audio (high quality)
                params.encodings[0].maxBitrate = 500_000;
              }
              
              await sender.setParameters(params).catch(() => {
                // Ignore errors in case the params setter is not supported
              });
            }
          } catch (err) {
            console.error(`Failed to allocate bandwidth for ${targetUserId}:`, err);
          }
        };
        
        // allocateBandwidth();
      } else if (pc.iceConnectionState === "failed") {
        console.error(`❌ ICE failed with ${targetUserId}`);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        s.emit("room-signal", {
          roomId: rid,
          targetUserId,
          signal: { type: "ice-candidate", candidate: event.candidate },
        });
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);

      if (event.track.kind === "audio") {
        let audio = audioRefs.current.get(targetUserId);
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          audio.muted = false;
          audio.volume = 1.0;
          audioRefs.current.set(targetUserId, audio);
          audio.style.display = "none";
          document.body.appendChild(audio);
        }
        const speakerId = selectedSpeakerIdRef.current;
        if (speakerId) {
          applySpeakerToAudio(audio, speakerId).catch(() => {});
        }
        audio.srcObject = remoteStream;
        if (isDeafenedRef.current) audio.muted = true;
        audio.play().catch(err => console.error(`Error playing audio for ${targetUserId}:`, err));
        setupRemoteAudioAnalyzer(remoteStream, targetUserId);
      } else if (event.track.kind === "video") {
        remoteVideoStreamsRef.current.set(targetUserId, remoteStream);
        const videoEl = videoElementsRef.current.get(targetUserId);
        if (videoEl) {
          videoEl.srcObject = remoteStream;
          videoEl.play().catch(() => {});
        }
      }
    };

    peerConnectionsRef.current.set(targetUserId, pc);

    if (initiator) {
      try {
        if (pc.signalingState !== "stable") return pc;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        s.emit("room-signal", {
          roomId: rid,
          targetUserId,
          signal: { type: "offer", sdp: offer },
        });
      } catch (error) {
        console.error("Failed to create offer:", error);
      }
    }

    return pc;
  };

  // ─── ICE candidate handling ─────────────────────────────────────
  const handleRemoteIceCandidate = async (fromUserId: string, candidate: RTCIceCandidateInit) => {
    const pc = peerConnectionsRef.current.get(fromUserId);
    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error(`Error adding ICE from ${fromUserId}:`, err);
      }
    } else {
      if (!iceCandidateBuffers.current.has(fromUserId)) iceCandidateBuffers.current.set(fromUserId, []);
      iceCandidateBuffers.current.get(fromUserId)!.push(candidate);
    }
  };

  const flushIceCandidates = async (fromUserId: string, pc: RTCPeerConnection) => {
    const buffered = iceCandidateBuffers.current.get(fromUserId) || [];
    if (buffered.length === 0) return;
    iceCandidateBuffers.current.delete(fromUserId);
    for (const candidate of buffered) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("Error adding buffered ICE:", err);
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════
  //  Socket event handlers (all use refs for stable closures)
  // ═══════════════════════════════════════════════════════════════

  const handleSignalImpl = async (data: { fromUserId: string; signal: any }) => {
    const { fromUserId, signal } = data;
    const s = socketRef.current;
    const rid = voiceRoomIdRef.current;
    if (!s || !rid) return;

    let pc = peerConnectionsRef.current.get(fromUserId);

    if (signal.type === "offer") {
      if (!pc) pc = await createPeerConnection(fromUserId, false);
      if (pc) {
        try {
          if (pc.signalingState !== "stable") {
            console.log(`[${fromUserId}] Not stable (${pc.signalingState}), rolling back`);
            await pc.setLocalDescription({ type: "rollback" });
          }
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await flushIceCandidates(fromUserId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          s.emit("room-signal", {
            roomId: rid,
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
          if (pc.signalingState !== "have-local-offer") return;
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

  const handleRoomParticipantsImpl = (data: { participants: RoomParticipant[] }) => {
    const u = userRef.current;
    const currentUserInList = data.participants.find(p => p.userId === u?._id);
    const allParticipants = currentUserInList
      ? data.participants
      : [
          ...data.participants,
          {
            userId: u?._id || "",
            name: u?.name || "",
            avatar: u?.avatarConfig?.image || null,
            color: u?.avatarConfig?.color || "#27272a",
            isSpeaking: false,
            isVideoOn: false,
            isScreenSharing: false,
            isMuted: isMutedRef.current,
          },
        ];
    setParticipants(allParticipants);

    // Create answerer connections for existing participants
    data.participants.forEach((participant) => {
      if (participant.userId !== u?._id && !peerConnectionsRef.current.has(participant.userId)) {
        createPeerConnection(participant.userId, false);
      }
    });
  };

  const handleUserJoinedImpl = (data: { userId: string; userName: string; avatar: string | null; color: string }) => {
    const u = userRef.current;
    setParticipants((prev) => {
      if (prev.find(p => p.userId === data.userId)) return prev;
      return [...prev, {
        userId: data.userId,
        name: data.userName,
        avatar: data.avatar,
        color: data.color,
        isSpeaking: false,
        isVideoOn: false,
        isScreenSharing: false,
        isMuted: false,
      }];
    });

    if (data.userId !== u?._id) {
      playJoinSound();
      createPeerConnection(data.userId, true);
    }
  };

  const handleUserLeftImpl = (data: { userId: string }) => {
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
      audio.pause();
      audio.srcObject = null;
      if (audio.parentNode) audio.parentNode.removeChild(audio);
      audioRefs.current.delete(data.userId);
    }

    // Clean up video
    remoteVideoStreamsRef.current.delete(data.userId);
    videoElementsRef.current.delete(data.userId);
    iceCandidateBuffers.current.delete(data.userId);

    // Stop speaking detection for this user
    const flag = speakingFlags.current.get(data.userId);
    if (flag) {
      flag.running = false;
      speakingFlags.current.delete(data.userId);
    }
    const frameId = animationFrames.current.get(data.userId);
    if (frameId !== undefined) {
      clearTimeout(frameId);
      animationFrames.current.delete(data.userId);
    }
  };

  const handleUserSpeakingImpl = (data: { userId: string; isSpeaking: boolean }) => {
    setParticipants(prev => prev.map(p => p.userId === data.userId ? { ...p, isSpeaking: data.isSpeaking } : p));
  };

  // ═══════════════════════════════════════════════════════════════
  //  Socket listener registration
  // ═══════════════════════════════════════════════════════════════

  const registerSocketListeners = (s: any) => {
    const onVideoToggle = (data: { userId: string; isVideoOn: boolean }) => {
      setParticipants(prev => prev.map(p => p.userId === data.userId ? { ...p, isVideoOn: data.isVideoOn } : p));
    };
    const onScreenShare = (data: { userId: string; isSharing: boolean }) => {
      setParticipants(prev => prev.map(p => p.userId === data.userId ? { ...p, isScreenSharing: data.isSharing } : p));
    };
    const onMuteToggle = (data: { userId: string; isMuted: boolean }) => {
      setParticipants(prev => prev.map(p => p.userId === data.userId ? { ...p, isMuted: data.isMuted } : p));
    };

    const listeners: Record<string, (...args: any[]) => void> = {
      "room-user-joined": handleUserJoinedImpl,
      "room-user-left": handleUserLeftImpl,
      "room-participants": handleRoomParticipantsImpl,
      "room-signal": handleSignalImpl,
      "user-speaking": handleUserSpeakingImpl,
      "room-video-toggle": onVideoToggle,
      "room-screen-share": onScreenShare,
      "room-mute-toggle": onMuteToggle,
    };

    Object.entries(listeners).forEach(([event, handler]) => {
      s.on(event, handler);
    });

    socketListenersRef.current = listeners;
  };

  const unregisterSocketListeners = (s: any) => {
    const listeners = socketListenersRef.current;
    if (!listeners) return;

    Object.entries(listeners).forEach(([event, handler]) => {
      s.off(event, handler);
    });

    socketListenersRef.current = null;
  };

  // ═══════════════════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════════════════

  const joinVoice = async (roomId: string, roomName: string): Promise<boolean> => {
    if (isVoiceConnectedRef.current) return false;
    const s = socketRef.current;
    const u = userRef.current;
    if (!s || !u) return false;

    // Join room in DB
    try {
      await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, userId: u._id }),
      });
    } catch (error) {
      console.error("Failed to join room in DB:", error);
      // Continue anyway — Socket.IO handles the real-time connection
    }

    // Get microphone
    const stream = await setupLocalAudio();
    if (!stream) return false;

    // Set refs BEFORE registering listeners (handlers read these refs)
    voiceRoomIdRef.current = roomId;

    // Register socket listeners BEFORE emitting join-room
    // so we catch the room-participants response
    registerSocketListeners(s);

    // Join socket room
    s.emit("join-room", {
      roomId,
      userId: u._id,
      userName: u.name,
      avatar: u.avatarConfig?.image,
      color: u.avatarConfig?.color,
    });

    // Update refs + reactive state
    isVoiceConnectedRef.current = true;
    setVoiceRoomId(roomId);
    setVoiceRoomName(roomName);
    setIsVoiceConnected(true);
    setIsInRoom(true);
    setCurrentRoomId(roomId);
    setCurrentRoomName(roomName);

    return true;
  };

  const leaveVoice = () => {
    const s = socketRef.current;
    const u = userRef.current;
    const rid = voiceRoomIdRef.current;

    // Unregister socket listeners
    if (s) unregisterSocketListeners(s);

    // Cleanup all WebRTC connections
    cleanupConnections();

    // Notify server
    if (s && rid && u) {
      s.emit("leave-room", { roomId: rid, userId: u._id });
    }

    // DB leave (fire-and-forget)
    if (u && rid) {
      fetch("/api/rooms/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: rid, userId: u._id }),
        keepalive: true,
      }).catch(() => {});
    }

    // Clear all state
    voiceRoomIdRef.current = null;
    isVoiceConnectedRef.current = false;
    setVoiceRoomId(null);
    setVoiceRoomName(null);
    setIsVoiceConnected(false);
    setParticipants([]);
    setIsMuted(false);
    setIsDeafened(false);
    setIsInRoom(false);
    setCurrentRoomId(null);
    setCurrentRoomName(null);
  };

  const toggleMute = () => {
    const currentStream = localStreamRef.current;
    if (currentStream) {
      const newMuted = !isMutedRef.current;
      currentStream.getAudioTracks().forEach((track) => {
        track.enabled = !newMuted;
      });
      setIsMuted(newMuted);

      // Broadcast mute state to other participants
      const s = socketRef.current;
      const u = userRef.current;
      const rid = voiceRoomIdRef.current;
      if (s && u && rid) {
        s.emit("room-mute-toggle", { roomId: rid, userId: u._id, isMuted: newMuted });
      }

      // Update own participant entry
      if (u) {
        setParticipants(prev => prev.map(p => p.userId === u._id ? { ...p, isMuted: newMuted } : p));
      }
    }
  };

  const toggleDeafen = () => {
    const newDeafened = !isDeafenedRef.current;
    audioRefs.current.forEach((audio) => {
      audio.muted = newDeafened;
    });
    setIsDeafened(newDeafened);
  };

  return (
    <RoomVoiceContext.Provider
      value={{
        isVoiceConnected,
        voiceRoomId,
        voiceRoomName,
        participants,
        setParticipants,
        isMuted,
        isDeafened,
        availableMics,
        availableSpeakers,
        selectedMicId,
        selectedSpeakerId,
        switchMicDevice,
        setSpeakerDevice,
        joinVoice,
        leaveVoice,
        toggleMute,
        toggleDeafen,
        peerConnectionsRef,
        remoteVideoStreamsRef,
        videoElementsRef,
        localStreamRef,
        localVideoTrackRef,
        localVideoStreamRef,
      }}
    >
      {children}
    </RoomVoiceContext.Provider>
  );
};

export const useRoomVoice = () => useContext(RoomVoiceContext);
