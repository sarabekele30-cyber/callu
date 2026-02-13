"use client";
import { useEffect, useRef, useState } from "react";
import { useSocket } from "@/context/SocketContext";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { Phone, PhoneOff, Mic, MicOff, Minimize2, Maximize2, Video, VideoOff } from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";

// ICE server config shared by both caller and answerer
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

export default function CallManager() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { outgoingCallData, setOutgoingCallData, setIsInCall } = useCall();

  const [incomingCall, setIncomingCall] = useState<{
    from: string;
    name: string;
    avatar?: string;
    signal: RTCSessionDescriptionInit;
    callType: "voice" | "video";
  } | null>(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [ringtoneMuted, setRingtoneMuted] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [remoteVideoAvailable, setRemoteVideoAvailable] = useState(false);

  const myVideo = useRef<HTMLVideoElement>(null);
  const userVideo = useRef<HTMLVideoElement>(null);
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const incomingRingtone = useRef<HTMLAudioElement | null>(null);
  const outgoingRingtone = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const localSpeakRaf = useRef<number | null>(null);
  const remoteSpeakRaf = useRef<number | null>(null);
  const callStartRef = useRef<number | null>(null);
  const callLoggedRef = useRef(false);

  // ICE candidate buffer - stores candidates that arrive before peer is ready
  const iceCandidateBuffer = useRef<RTCIceCandidateInit[]>([]);
  const audioUnlocked = useRef(false);
  // Use ref for stream so cleanup always has latest value
  const streamRef = useRef<MediaStream | null>(null);

  // ─── Audio helpers ───────────────────────────────────────────
  const playRingtone = (audio: HTMLAudioElement | null, name: string) => {
    if (!audio) return;
    audio.currentTime = 0;
    audio.volume = 1;
    audio.muted = false;
    audio.loop = true;

    audio.play()
      .then(() => console.log(`🔔 ${name} playing`))
      .catch(() => {
        // Try muted fallback (browser may allow muted autoplay)
        audio.muted = true;
        audio.play()
          .then(() => console.log(`🔕 ${name} playing muted — click anywhere to unmute`))
          .catch((e) => console.error(`❌ ${name} completely blocked:`, e.message));
      });
  };

  const stopRingtone = (audio: HTMLAudioElement | null) => {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  };

  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const startSpeakingDetector = (
    stream: MediaStream,
    setSpeaking: (value: boolean) => void,
    analyserRef: React.MutableRefObject<AnalyserNode | null>,
    rafRef: React.MutableRefObject<number | null>
  ) => {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let lastSpeaking = false;

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
      const speaking = average > 15;

      if (speaking !== lastSpeaking) {
        lastSpeaking = speaking;
        setSpeaking(speaking);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    tick();
  };

  // ─── Unlock audio on first-ever user interaction ─────────────
  useEffect(() => {
    const unlock = () => {
      if (audioUnlocked.current) return;
      audioUnlocked.current = true;

      // Resume an AudioContext to globally unlock audio playback
      const ctx = new AudioContext();
      ctx.resume().then(() => {
        ctx.close();
        console.log("🔓 Audio unlocked by user interaction");
      });

      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume();
      }

      // Unmute any playing-but-muted ringtones
      if (incomingRingtone.current && !incomingRingtone.current.paused && incomingRingtone.current.muted) {
        incomingRingtone.current.muted = false;
        incomingRingtone.current.play().catch(() => {});
        console.log("🔊 Incoming ringtone unmuted");
      }
      if (outgoingRingtone.current && !outgoingRingtone.current.paused && outgoingRingtone.current.muted) {
        outgoingRingtone.current.muted = false;
        outgoingRingtone.current.play().catch(() => {});
        console.log("🔊 Outgoing ringtone unmuted");
      }

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

  // ─── Initialize ringtone elements ────────────────────────────
  useEffect(() => {
    incomingRingtone.current = new Audio("/music/callin.mp3");
    incomingRingtone.current.loop = true;
    incomingRingtone.current.volume = 1;
    outgoingRingtone.current = new Audio("/music/ringing.mp3");
    outgoingRingtone.current.loop = true;
    outgoingRingtone.current.volume = 1;

    // Poll for muted ringtones to show UI banner
    const interval = setInterval(() => {
      const incoming = incomingRingtone.current;
      const outgoing = outgoingRingtone.current;
      const isMuted =
        (incoming && !incoming.paused && incoming.muted) ||
        (outgoing && !outgoing.paused && outgoing.muted);
      setRingtoneMuted(!!isMuted);
    }, 200);

    return () => clearInterval(interval);
  }, []);

  // ─── Local cleanup (no socket emit) ──────────────────────────
  const endCallLocally = () => {
    const shouldLog = callAccepted && !!callStartRef.current;
    if (shouldLog) {
      void logCall("completed");
    }

    stopRingtone(incomingRingtone.current);
    stopRingtone(outgoingRingtone.current);

    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
    }

    const currentStream = streamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    }

    if (myVideo.current) myVideo.current.srcObject = null;
    if (userVideo.current) userVideo.current.srcObject = null;

    iceCandidateBuffer.current = [];
    setIncomingCall(null);
    setOutgoingCallData(null);
    setCallAccepted(false);
    setIsInCall(false);
    setIsMicOn(true);
    setAudioBlocked(false);
    setIsLocalSpeaking(false);
    setIsRemoteSpeaking(false);
    setIsMinimized(false);

    if (localSpeakRaf.current) cancelAnimationFrame(localSpeakRaf.current);
    if (remoteSpeakRaf.current) cancelAnimationFrame(remoteSpeakRaf.current);
    localSpeakRaf.current = null;
    remoteSpeakRaf.current = null;
    localAnalyserRef.current = null;
    remoteAnalyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsVideoOn(true);
    setRemoteVideoAvailable(false);

    socket?.off("call-answered");
  };

  const logCall = async (status: "completed" | "missed" | "rejected") => {
    if (callLoggedRef.current) return;
    if (!callStartRef.current) return;
    const ownerId = user?._id;
    const otherUserId = outgoingCallData ? outgoingCallData.userId : incomingCall?.from;
    const type = outgoingCallData ? "outgoing" : "incoming";
    if (!ownerId || !otherUserId) return;

    const duration = Math.max(0, Math.floor((Date.now() - callStartRef.current) / 1000));
    callLoggedRef.current = true;

    try {
      await fetch("/api/calls/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId,
          otherUserId,
          type,
          duration,
          status,
        }),
      });
    } catch (error) {
      console.error("Failed to log call:", error);
    }
  };

  const cancelOutgoingAttempt = () => {
    stopRingtone(outgoingRingtone.current);

    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
    }

    const currentStream = streamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    }

    if (myVideo.current) myVideo.current.srcObject = null;
    if (userVideo.current) userVideo.current.srcObject = null;

    iceCandidateBuffer.current = [];
    setOutgoingCallData(null);
    setCallAccepted(false);
    setIsMicOn(true);
  };

  // ─── End call (notify other party + cleanup) ─────────────────
  const endCall = () => {
    const otherUserId = incomingCall?.from || outgoingCallData?.userId;
    if (otherUserId && socket) {
      console.log("📴 Ending call, notifying:", otherUserId);
      socket.emit("end-call", { to: otherUserId, from: user?._id });
    }
    endCallLocally();
  };

  // ─── Flush buffered ICE candidates into peer ─────────────────
  const flushIceCandidates = async (peer: RTCPeerConnection) => {
    const buffered = [...iceCandidateBuffer.current];
    iceCandidateBuffer.current = [];
    if (buffered.length === 0) return;

    console.log(`🧊 Flushing ${buffered.length} buffered ICE candidates`);
    for (const candidate of buffered) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("❌ Error adding buffered ICE candidate:", err);
      }
    }
  };

  // ─── Handle remote ICE candidate (buffer or add) ─────────────
  const handleRemoteIceCandidate = async (candidate: RTCIceCandidateInit) => {
    const peer = connectionRef.current;
    if (peer && peer.remoteDescription) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`🧊 Added ICE candidate directly`);
      } catch (err) {
        console.error("❌ Error adding ICE candidate:", err);
      }
    } else {
      iceCandidateBuffer.current.push(candidate);
      console.log(`🧊 Buffered ICE candidate (total: ${iceCandidateBuffer.current.length})`);
    }
  };

  // ─── Global socket listeners ─────────────────────────────────
  // This is the KEY fix — signal-received is registered GLOBALLY so
  // we NEVER miss ICE candidates regardless of timing
  useEffect(() => {
    if (!socket) return;

    socket.on("call-made", (data: { from: string; name: string; avatar?: string; signal: RTCSessionDescriptionInit; callType: "voice" | "video" }) => {
      const sameUserAsOutgoing = outgoingCallData?.userId === data.from;

      if (callAccepted) {
        socket.emit("end-call", { to: data.from, from: user?._id });
        return;
      }

      if (sameUserAsOutgoing) {
        cancelOutgoingAttempt();
      }

      setIncomingCall({ from: data.from, name: data.name, avatar: data.avatar, signal: data.signal, callType: data.callType });
      setIsInCall(true);
      iceCandidateBuffer.current = [];
      console.log("📞 Incoming call from", data.name);
      playRingtone(incomingRingtone.current, "Incoming ringtone");
    });

    socket.on("call-ended", () => {
      console.log("📴 Other party ended the call");
      endCallLocally();
    });

    // GLOBAL ICE candidate listener — never misses candidates
    socket.on("signal-received", async (data: { signal: { candidate?: RTCIceCandidateInit }; from: string }) => {
      if (data.signal?.candidate) {
        await handleRemoteIceCandidate(data.signal.candidate);
      }
    });

    return () => {
      socket.off("call-made");
      socket.off("call-ended");
      socket.off("signal-received");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // ─── Play outgoing ringtone ──────────────────────────────────
  useEffect(() => {
    if (outgoingCallData && !callAccepted) {
      console.log("📞 Calling", outgoingCallData.userName);
      playRingtone(outgoingRingtone.current, "Outgoing ringtone");
    } else if (callAccepted) {
      stopRingtone(outgoingRingtone.current);
    }
  }, [outgoingCallData, callAccepted]);

  useEffect(() => {
    if (incomingCall || outgoingCallData) {
      callStartRef.current = null;
      callLoggedRef.current = false;
    }
  }, [incomingCall, outgoingCallData]);

  useEffect(() => {
    if (callAccepted && !callStartRef.current) {
      callStartRef.current = Date.now();
    }
  }, [callAccepted]);

  // ─── Attach remote stream to video element ───────────────────
  const attachRemoteStream = (event: RTCTrackEvent, role: string) => {
    console.log(`[${role}] Received remote track:`, event.track.kind, event.streams.length);
    if (!userVideo.current || !event.streams[0]) return;

    if (event.track.kind === "video") {
      setRemoteVideoAvailable(true);
    }

    userVideo.current.srcObject = event.streams[0];
    userVideo.current.muted = false;
    userVideo.current.volume = 1;

    console.log(`[${role}] Set remote stream, tracks:`,
      event.streams[0].getTracks().map((t) => `${t.kind} enabled:${t.enabled}`)
    );

    userVideo.current.play()
      .then(() => {
        console.log(`✅ [${role}] Remote audio playing (vol: ${userVideo.current!.volume}, muted: ${userVideo.current!.muted})`);
        setAudioBlocked(false);
      })
      .catch((err) => {
        console.error(`❌ [${role}] Remote audio blocked:`, err.message);
        setAudioBlocked(true);
      });

    startSpeakingDetector(event.streams[0], setIsRemoteSpeaking, remoteAnalyserRef, remoteSpeakRaf);
  };

  // ─── Set up peer connection state monitors ───────────────────
  const setupPeerMonitors = (peer: RTCPeerConnection, role: string) => {
    let failTimeout: ReturnType<typeof setTimeout> | null = null;

    peer.onconnectionstatechange = () => {
      console.log(`[${role}] Connection state:`, peer.connectionState);
      if (peer.connectionState === "connected") {
        console.log(`✅ [${role}] Connection established!`);
        if (failTimeout) clearTimeout(failTimeout);
      } else if (peer.connectionState === "failed") {
        console.error(`❌ [${role}] Connection failed, waiting 5s...`);
        failTimeout = setTimeout(() => {
          if (connectionRef.current?.connectionState === "failed") {
            console.error(`❌ [${role}] Still failed after 5s, ending call`);
            endCall();
          }
        }, 5000);
      }
    };

    peer.oniceconnectionstatechange = () => {
      console.log(`[${role}] ICE state:`, peer.iceConnectionState);
      if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
        console.log(`✅ [${role}] ICE connected!`);
        if (failTimeout) clearTimeout(failTimeout);
      }
    };

    peer.onicegatheringstatechange = () => {
      console.log(`[${role}] ICE gathering:`, peer.iceGatheringState);
    };
  };

  // ─── START CALL (Caller) ─────────────────────────────────────
  const startCall = async (idToCall: string) => {
    try {
      const callType = outgoingCallData?.callType || "voice";
      const mediaConstraints = {
        video: callType === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        audio: true,
      };
      const currentStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      setStream(currentStream);
      streamRef.current = currentStream;
      if (myVideo.current) myVideo.current.srcObject = currentStream;
      console.log("[CALLER] Got local stream, type:", callType);

      startSpeakingDetector(currentStream, setIsLocalSpeaking, localAnalyserRef, localSpeakRaf);

      const peer = new RTCPeerConnection(ICE_CONFIG);
      connectionRef.current = peer;

      // Add audio tracks
      currentStream.getTracks().forEach((track) => {
        peer.addTrack(track, currentStream);
        console.log("[CALLER] Added track:", track.kind);
      });

      // Set up monitors
      setupPeerMonitors(peer, "CALLER");

      // Send ICE candidates to answerer
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("[CALLER] Sending ICE (type:", event.candidate.type, ")");
          socket?.emit("send-signal", {
            to: idToCall,
            signal: { candidate: event.candidate },
            from: user?._id,
          });
        } else {
          console.log("[CALLER] All ICE candidates sent");
        }
      };

      // Receive audio from answerer
      peer.ontrack = (event) => attachRemoteStream(event, "CALLER");

      // Listen for answer BEFORE sending offer (so we don't miss it)
      socket?.off("call-answered");
      socket?.on("call-answered", async (data: { signal: RTCSessionDescriptionInit; from: string }) => {
        console.log("[CALLER] Received answer", data.signal ? "✅" : "❌ NO SIGNAL");
        if (data.signal?.type && data.signal?.sdp) {
          try {
            await peer.setRemoteDescription(new RTCSessionDescription(data.signal));
            console.log("[CALLER] Set remote description (answer)");

            // NOW flush any ICE candidates that were buffered
            await flushIceCandidates(peer);

            stopRingtone(outgoingRingtone.current);
            setCallAccepted(true);
          } catch (err) {
            console.error("[CALLER] Error setting remote description:", err);
          }
        } else {
          console.error("[CALLER] Invalid signal in call-answered");
        }
      });

      // Create and send offer
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      console.log("[CALLER] Created + sent offer");

      socket?.emit("call-user", {
        userToCall: idToCall,
        signalData: offer,
        from: user?._id,
        name: user?.name,
        avatar: user?.avatarConfig?.image,
        callType: callType,
      });
    } catch (err) {
      console.error("Failed to start call:", err);
      endCall();
    }
  };

  // ─── ANSWER CALL (Answerer) ──────────────────────────────────
  const answerCall = async () => {
    if (!incomingCall) return;

    // User clicked Accept — this IS a user gesture
    if (incomingRingtone.current?.muted) {
      incomingRingtone.current.muted = false;
    }
    stopRingtone(incomingRingtone.current);
    setCallAccepted(true);

    try {
      const callType = incomingCall.callType || "voice";
      const mediaConstraints = {
        video: callType === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        audio: true,
      };
      const currentStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      setStream(currentStream);
      streamRef.current = currentStream;
      if (myVideo.current) myVideo.current.srcObject = currentStream;
      console.log("[ANSWERER] Got local stream, type:", callType);

      startSpeakingDetector(currentStream, setIsLocalSpeaking, localAnalyserRef, localSpeakRaf);

      const peer = new RTCPeerConnection(ICE_CONFIG);
      connectionRef.current = peer;

      // Add audio tracks
      currentStream.getTracks().forEach((track) => {
        peer.addTrack(track, currentStream);
        console.log("[ANSWERER] Added track:", track.kind);
      });

      // Set up monitors
      setupPeerMonitors(peer, "ANSWERER");

      // Send ICE candidates to caller
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("[ANSWERER] Sending ICE (type:", event.candidate.type, ")");
          socket?.emit("send-signal", {
            to: incomingCall.from,
            signal: { candidate: event.candidate },
            from: user?._id,
          });
        } else {
          console.log("[ANSWERER] All ICE candidates sent");
        }
      };

      // Receive audio from caller
      peer.ontrack = (event) => attachRemoteStream(event, "ANSWERER");

      // Set remote description (the caller's offer)
      console.log("[ANSWERER] Setting remote description (offer)");
      await peer.setRemoteDescription(new RTCSessionDescription(incomingCall.signal));

      // Flush ICE candidates that arrived while user was deciding to Accept
      await flushIceCandidates(peer);

      // Create and send answer
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      console.log("[ANSWERER] Created + sent answer");

      socket?.emit("answer-call", {
        signal: answer,
        to: incomingCall.from,
        from: user?._id,
      });
    } catch (err) {
      console.error("Failed to answer call:", err);
      endCall();
    }
  };

  const toggleMic = () => {
    const audioTrack = stream?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !isMicOn;
      setIsMicOn(!isMicOn);
    }
  };

  const toggleCamera = () => {
    const videoTrack = stream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !isVideoOn;
      setIsVideoOn(!isVideoOn);
    }
  };

  const enableAudio = () => {
    // Unmute ringtones on click
    if (incomingRingtone.current && !incomingRingtone.current.paused && incomingRingtone.current.muted) {
      incomingRingtone.current.muted = false;
    }
    if (outgoingRingtone.current && !outgoingRingtone.current.paused && outgoingRingtone.current.muted) {
      outgoingRingtone.current.muted = false;
    }
    // Unmute WebRTC audio
    if (userVideo.current && audioBlocked) {
      userVideo.current.play()
        .then(() => {
          console.log("✅ Audio enabled by click");
          setAudioBlocked(false);
        })
        .catch((err) => console.error("❌ Still blocked:", err));
    }

    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
  };

  // ─── Trigger outgoing call ───────────────────────────────────
  useEffect(() => {
    if (outgoingCallData && !callAccepted && !incomingCall) {
      startCall(outgoingCallData.userId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outgoingCallData, incomingCall]);

  // ─── RENDER ──────────────────────────────────────────────────
  if (!incomingCall && !outgoingCallData) return null;

  if (isMinimized && callAccepted) {
    const displayName = incomingCall?.name || outgoingCallData?.userName || "Call";
    return (
      <div className="fixed bottom-6 right-6 z-50 rounded-2xl overflow-hidden shadow-2xl w-48 h-32 bg-black border border-zinc-700" onClick={enableAudio}>
        {/* Remote video in background */}
        {remoteVideoAvailable && (
          <video
            playsInline
            ref={userVideo}
            autoPlay
            className="w-full h-full object-cover absolute inset-0"
          />
        )}
        
        {/* Local video overlay in corner */}
        {isVideoOn && (
          <video
            playsInline
            muted
            ref={myVideo}
            autoplay
            className="absolute bottom-1 right-1 w-16 h-16 rounded-lg object-cover border border-zinc-600"
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-between p-2">
          <div className="text-xs font-medium text-white truncate">{displayName}</div>
          
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(false);
              }}
              className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200"
              aria-label="Restore call"
            >
              <Maximize2 size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleCamera();
              }}
              className={`p-1.5 rounded-lg ${!isVideoOn ? "bg-red-600/80" : "bg-zinc-800/80"} text-white`}
              aria-label="Toggle camera"
            >
              {isVideoOn ? <Video size={14} /> : <VideoOff size={14} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleMic();
              }}
              className={`p-1.5 rounded-lg ${!isMicOn ? "bg-red-600/80" : "bg-zinc-800/80"} text-white`}
              aria-label="Toggle mic"
            >
              {isMicOn ? <Mic size={14} /> : <MicOff size={14} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                endCall();
              }}
              className="p-1.5 rounded-lg bg-red-600/80 text-white"
              aria-label="End call"
            >
              <PhoneOff size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md" onClick={enableAudio}>
      {callAccepted ? (
        // Call connected view - conditional UI based on call type
        outgoingCallData?.callType === "voice" || incomingCall?.callType === "voice" ? (
          // VOICE CALL - Modal style
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-8 w-full max-w-md mx-4 flex flex-col items-center relative shadow-2xl">
            <button
              onClick={() => setIsMinimized(true)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
              aria-label="Minimize call"
            >
              <Minimize2 size={16} />
            </button>

            <div className="w-48 h-48 mb-2">
              <DotLottieReact src="/Lotties/love.lottie" loop autoplay />
            </div>
            <div className="flex items-center justify-center gap-2 mb-1">
              <h3 className="text-2xl font-medium text-white">{incomingCall?.name || outgoingCallData?.userName}</h3>
              <img src="/Verification-Blue-Tick-PNG.webp" alt="Verified" className="w-6 h-6 flex-shrink-0" />
            </div>
            <div className="flex items-center gap-2 mb-8">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-sm text-emerald-400">Connected</span>
            </div>

            <div className="flex items-center gap-3 mb-8">
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${isLocalSpeaking ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}>
                <span className="text-[11px] uppercase tracking-widest">You</span>
                {isLocalSpeaking && (
                  <div className="flex items-center gap-0.5">
                    <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "4px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0s" }}></span>
                    <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "6px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0.1s" }}></span>
                    <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "4px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0.2s" }}></span>
                  </div>
                )}
              </div>
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${isRemoteSpeaking ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}>
                <span className="text-[11px] uppercase tracking-widest">Them</span>
                {isRemoteSpeaking && (
                  <div className="flex items-center gap-0.5">
                    <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "4px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0s" }}></span>
                    <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "6px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0.1s" }}></span>
                    <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "4px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0.2s" }}></span>
                  </div>
                )}
              </div>
            </div>

            {/* Call Controls */}
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={toggleMic}
                  className={`p-4 rounded-full transition-all cursor-pointer ${
                    !isMicOn ? "bg-red-500 text-white shadow-lg shadow-red-500/50" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
                </button>
                <span className="text-xs text-zinc-500">{isMicOn ? "Mute" : "Unmute"}</span>
              </div>

              <div className="flex flex-col items-center gap-2">
                <button onClick={endCall} className="p-5 rounded-full bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg hover:shadow-red-500/50 cursor-pointer">
                  <PhoneOff size={28} />
                </button>
                <span className="text-xs text-zinc-500">End call</span>
              </div>
            </div>

            {/* Hidden audio/video elements */}
            <div className="hidden">
              <video playsInline muted ref={myVideo} autoPlay />
              <video playsInline ref={userVideo} autoPlay controls={false} />
            </div>
          </div>
        ) : (
          // VIDEO CALL - Full-screen style
          <div className="fixed inset-0 bg-black flex flex-col items-center justify-between p-6 z-50">
            <button
              onClick={() => setIsMinimized(true)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 z-10"
              aria-label="Minimize call"
            >
              <Minimize2 size={16} />
            </button>

            {/* Main video grid */}
            <div className="flex-1 w-full max-h-[70vh] relative bg-black rounded-lg overflow-hidden flex items-center justify-center mb-4">
              {/* Remote video (large) */}
              <video
                playsInline
                ref={userVideo}
                autoPlay
                className="w-full h-full object-cover absolute inset-0"
              />

              {/* Local video (picture-in-picture) */}
              {isVideoOn && (
                <video
                  playsInline
                  muted
                  ref={myVideo}
                  autoPlay
                  className="absolute bottom-4 right-4 w-32 h-40 object-cover rounded-lg border-2 border-zinc-700 shadow-lg"
                />
              )}

              {/* Fallback if no remote video */}
              {!remoteVideoAvailable && (
                <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-black flex flex-col items-center justify-center">
                  <div className="w-32 h-32 rounded-full mb-4 overflow-hidden ring-4 ring-green-500">
                    {incomingCall?.avatar ? (
                      <img src={incomingCall.avatar} alt={incomingCall.name} className="w-full h-full object-cover" />
                    ) : outgoingCallData?.userAvatar ? (
                      <img src={outgoingCallData.userAvatar} alt={outgoingCallData.userName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-4xl font-bold text-white">
                        {(incomingCall?.name || outgoingCallData?.userName || "?")[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <p className="text-zinc-400">Waiting for video...</p>
                </div>
              )}

              {/* Speaking indicators overlay */}
              <div className="absolute top-4 left-4 flex gap-2">
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${isLocalSpeaking ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}>
                  <span className="text-[10px] uppercase tracking-widest">You</span>
                  {isLocalSpeaking && (
                    <div className="flex items-center gap-0.5">
                      <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "4px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0s" }}></span>
                      <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "6px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0.1s" }}></span>
                      <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "4px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0.2s" }}></span>
                    </div>
                  )}
                </div>

                <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${isRemoteSpeaking ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}>
                  <span className="text-[10px] uppercase tracking-widest">Them</span>
                  {isRemoteSpeaking && (
                    <div className="flex items-center gap-0.5">
                      <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "4px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0s" }}></span>
                      <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "6px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0.1s" }}></span>
                      <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: "4px", animation: "soundwave 0.6s ease-in-out infinite", animationDelay: "0.2s" }}></span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Call info and controls */}
            <div className="text-center mb-4">
              <div className="flex items-center justify-center gap-2 mb-1">
                <h3 className="text-xl font-medium text-white">{incomingCall?.name || outgoingCallData?.userName}</h3>
                <img src="/Verification-Blue-Tick-PNG.webp" alt="Verified" className="w-5 h-5 flex-shrink-0" />
              </div>
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-sm text-emerald-400">Connected</span>
              </div>
            </div>

            {/* Call Controls */}
            <div className="flex items-center gap-4 bg-zinc-900/80 px-6 py-4 rounded-full border border-zinc-700">
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={toggleCamera}
                  className={`p-3 rounded-full transition-all cursor-pointer ${
                    !isVideoOn ? "bg-red-500 text-white shadow-lg shadow-red-500/50" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                  aria-label="Toggle camera"
                >
                  {isVideoOn ? <Video size={20} /> : <VideoOff size={20} />}
                </button>
              </div>

              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={toggleMic}
                  className={`p-3 rounded-full transition-all cursor-pointer ${
                    !isMicOn ? "bg-red-500 text-white shadow-lg shadow-red-500/50" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                  aria-label="Toggle mic"
                >
                  {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
              </div>

              <div className="flex flex-col items-center gap-1">
                <button onClick={endCall} className="p-3 rounded-full bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg hover:shadow-red-500/50 cursor-pointer">
                  <PhoneOff size={20} />
                </button>
              </div>
            </div>

            {/* Hidden audio/video elements */}
            <div className="hidden">
              <video playsInline muted ref={myVideo} autoPlay />
              <video playsInline ref={userVideo} autoPlay controls={false} />
            </div>
          </div>
        )
      ) : (
        // Call pre-connection modal
        <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-8 w-full max-w-md mx-4 flex flex-col items-center relative shadow-2xl">

        {/* Audio Blocked Banner */}
        {audioBlocked && callAccepted && (
          <div className="absolute top-4 left-4 right-4 bg-yellow-500/90 text-black px-4 py-2 rounded-xl text-sm font-medium text-center animate-pulse">
            🔊 Click anywhere to enable audio
          </div>
        )}

        {/* Ringtone Muted Banner */}
        {ringtoneMuted && !callAccepted && (
          <div className="absolute top-4 left-4 right-4 bg-orange-500/90 text-white px-4 py-2 rounded-xl text-sm font-medium text-center animate-pulse">
            🔇 Ringtone is muted — Click to unmute
          </div>
        )}

        {/* Pre-Connect UI */}
        {!callAccepted && (
          <div className="flex flex-col items-center justify-center py-8">
            {/* Avatar */}
            {incomingCall && (
              <div className="w-32 h-32 rounded-full overflow-hidden mb-6 ring-4 ring-green-500 ring-offset-4 ring-offset-zinc-900">
                {incomingCall.avatar ? (
                  <img src={incomingCall.avatar} alt={incomingCall.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                    <span className="text-4xl font-bold text-white">{incomingCall.name[0].toUpperCase()}</span>
                  </div>
                )}
              </div>
            )}
            {!incomingCall && outgoingCallData && (
              <div className="w-32 h-32 rounded-full overflow-hidden mb-6 ring-4 ring-blue-500 ring-offset-4 ring-offset-zinc-900 animate-pulse">
                {outgoingCallData.userAvatar ? (
                  <img src={outgoingCallData.userAvatar} alt={outgoingCallData.userName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                    <span className="text-4xl font-bold text-white">{outgoingCallData.userName[0].toUpperCase()}</span>
                  </div>
                )}
              </div>
            )}

            {incomingCall ? (
              <>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <h3 className="text-2xl font-medium text-white text-center">{incomingCall.name}</h3>
                  <img src="/Verification-Blue-Tick-PNG.webp" alt="Verified" className="w-6 h-6 flex-shrink-0" />
                </div>
                <p className="text-zinc-400 mb-8">
                  Incoming {incomingCall.callType === "video" ? "video" : "voice"} call...
                </p>
                <div className="flex gap-6">
                  <div className="flex flex-col items-center gap-2">
                    <button onClick={endCall} className="bg-red-500 hover:bg-red-600 p-5 rounded-full transition-all shadow-lg hover:shadow-red-500/50 cursor-pointer">
                      <PhoneOff className="text-white" size={28} />
                    </button>
                    <span className="text-xs text-zinc-500">Decline</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <button onClick={answerCall} className="bg-green-500 hover:bg-green-600 p-5 rounded-full transition-all animate-bounce shadow-lg hover:shadow-green-500/50 cursor-pointer">
                      <Phone className="text-white" size={28} />
                    </button>
                    <span className="text-xs text-zinc-500">Accept</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <h3 className="text-2xl font-medium text-white text-center">{outgoingCallData?.userName}</h3>
                  <img src="/Verification-Blue-Tick-PNG.webp" alt="Verified" className="w-6 h-6 flex-shrink-0" />
                </div>
                <p className="text-zinc-400 mb-8">
                  {outgoingCallData?.callType === "video" ? "Calling (video)..." : "Calling (voice)..."}
                </p>
                <div className="flex flex-col items-center gap-2">
                  <button onClick={endCall} className="bg-red-500 hover:bg-red-600 p-5 rounded-full transition-all shadow-lg hover:shadow-red-500/50 cursor-pointer">
                    <PhoneOff className="text-white" size={28} />
                  </button>
                  <span className="text-xs text-zinc-500">End call</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Hidden audio/video elements */}
        <div className="hidden">
          <video playsInline muted ref={myVideo} autoPlay />
          <video playsInline ref={userVideo} autoPlay controls={false} />
        </div>
        </div>
      )}
    </div>
  );
}
