"use client";
import { useEffect, useRef, useState } from "react";
import { useSocket } from "@/context/SocketContext";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";
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
  } | null>(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [ringtoneMuted, setRingtoneMuted] = useState(false);

  const myVideo = useRef<HTMLVideoElement>(null);
  const userVideo = useRef<HTMLVideoElement>(null);
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const incomingRingtone = useRef<HTMLAudioElement | null>(null);
  const outgoingRingtone = useRef<HTMLAudioElement | null>(null);

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

    socket?.off("call-answered");
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

    socket.on("call-made", (data: { from: string; name: string; avatar?: string; signal: RTCSessionDescriptionInit }) => {
      setIncomingCall({ from: data.from, name: data.name, avatar: data.avatar, signal: data.signal });
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

  // ─── Attach remote stream to video element ───────────────────
  const attachRemoteStream = (event: RTCTrackEvent, role: string) => {
    console.log(`[${role}] Received remote track:`, event.track.kind, event.streams.length);
    if (!userVideo.current || !event.streams[0]) return;

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
      const currentStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      setStream(currentStream);
      streamRef.current = currentStream;
      if (myVideo.current) myVideo.current.srcObject = currentStream;
      console.log("[CALLER] Got local stream");

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
      const currentStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      setStream(currentStream);
      streamRef.current = currentStream;
      if (myVideo.current) myVideo.current.srcObject = currentStream;
      console.log("[ANSWERER] Got local stream");

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
  };

  // ─── Trigger outgoing call ───────────────────────────────────
  useEffect(() => {
    if (outgoingCallData && !callAccepted) {
      startCall(outgoingCallData.userId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outgoingCallData]);

  // ─── RENDER ──────────────────────────────────────────────────
  if (!incomingCall && !outgoingCallData) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md" onClick={enableAudio}>
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
                <p className="text-zinc-400 mb-8">Incoming voice call...</p>
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
                <p className="text-zinc-400 mb-8">Calling...</p>
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

        {/* Audio Call Connected View */}
        {callAccepted && (
          <div className="flex flex-col items-center py-8 w-full">
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
          </div>
        )}

        {/* Hidden audio/video elements */}
        <div className="hidden">
          <video playsInline muted ref={myVideo} autoPlay />
          <video playsInline ref={userVideo} autoPlay controls={false} />
        </div>
      </div>
    </div>
  );
}
