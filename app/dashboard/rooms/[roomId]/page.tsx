"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useRouter, useParams } from "next/navigation";
import {
  Volume2, VolumeX, PhoneOff, Mic, MicOff,
  Video, VideoOff, MonitorUp, MonitorOff,
  PictureInPicture2, LayoutGrid, Maximize2,
  Wrench, Music,
} from "lucide-react";
import { useSocket } from "@/context/SocketContext";
import { useRoomVoice } from "@/context/RoomVoiceContext";
import { toast } from "sonner";
import RoomMusicPlayer from "@/components/RoomMusicPlayer";

interface Room {
  _id: string;
  name: string;
  description: string;
  createdBy: { _id: string; name: string };
  participants: Array<{
    _id: string;
    name: string;
    avatarConfig: { image?: string; color: string };
  }>;
  maxParticipants: number;
  isActive: boolean;
  roomType: "public" | "private";
}

export default function RoomVoiceChatPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const roomId = params?.roomId as string;
  const { socket } = useSocket();

  // ─── Voice state from persistent context ────────────────────────
  const {
    isVoiceConnected,
    voiceRoomId,
    participants,
    setParticipants,
    isMuted,
    isDeafened,
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
  } = useRoomVoice();

  // ─── Local page state (dies on navigation — that's fine) ────────
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isInPiP, setIsInPiP] = useState(false);
  const [layout, setLayout] = useState<"grid" | "spotlight">("grid");
  const [spotlightUserId, setSpotlightUserId] = useState<string | null>(null);
  const [isMusicOpen, setIsMusicOpen] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);

  // ─── Local refs (video-only, page-scoped) ───────────────────────
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const localVideoElRef = useRef<HTMLVideoElement | null>(null);
  const mixingCtxRef = useRef<AudioContext | null>(null);
  const originalMicTrackRef = useRef<MediaStreamTrack | null>(null);

  // Refs for stable cleanup closures
  const socketRef = useRef(socket);
  const userIdRef = useRef(user?._id);
  const isVideoOnRef = useRef(false);
  const isScreenSharingRef = useRef(false);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { userIdRef.current = user?._id; }, [user]);
  useEffect(() => { isVideoOnRef.current = isVideoOn; }, [isVideoOn]);
  useEffect(() => { isScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);

  // ═══════════════════════════════════════════════════════════════════
  //  Room details fetch
  // ═══════════════════════════════════════════════════════════════════

  const fetchRoomDetails = async (): Promise<Room | null> => {
    try {
      const response = await fetch(`/api/rooms?roomId=${roomId}`);
      const data = await response.json();
      if (response.ok && data.rooms?.length > 0) {
        setRoom(data.rooms[0]);
        return data.rooms[0];
      } else {
        toast.error("Room not found");
        router.push("/dashboard/members");
        return null;
      }
    } catch (error) {
      console.error("Failed to fetch room:", error);
      router.push("/dashboard/members");
      return null;
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Initialize: join voice OR reconnect UI
  // ═══════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!user || !roomId) {
      router.push("/dashboard/members");
      return;
    }

    // Already connected to THIS room → just load room info
    if (voiceRoomId === roomId) {
      fetchRoomDetails();
      return;
    }

    // Connected to a DIFFERENT room → leave old, join new
    if (isVoiceConnected && voiceRoomId !== roomId) {
      leaveVoice();
    }

    // Refresh protection: no join-intent flag → kick to dashboard
    const joinIntent = sessionStorage.getItem("room-join-intent");
    if (!joinIntent) {
      router.replace("/dashboard/members");
      return;
    }
    sessionStorage.removeItem("room-join-intent");

    const init = async () => {
      const roomData = await fetchRoomDetails();
      if (!roomData) return;

      const success = await joinVoice(roomId, roomData.name);
      if (!success) {
        toast.error("Failed to join voice channel");
        router.push("/dashboard/members");
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, roomId]);

  // ═══════════════════════════════════════════════════════════════════
  //  Clean up VIDEO on page unmount (voice stays connected!)
  // ═══════════════════════════════════════════════════════════════════

  useEffect(() => {
    // Capture refs for cleanup closure
    const pcRef = peerConnectionsRef;
    const localSRef = localStreamRef;

    return () => {
      const hadVideo = isVideoOnRef.current;
      const hadScreen = isScreenSharingRef.current;
      const peers = pcRef.current;

      // Stop screen share tracks
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }

      // Stop camera / video tracks
      if (localVideoTrackRef.current) {
        localVideoTrackRef.current.stop();
        localVideoTrackRef.current = null;
      }
      if (localVideoStreamRef.current) {
        localVideoStreamRef.current.getTracks().forEach((t) => t.stop());
        localVideoStreamRef.current = null;
      }

      // Replace video track with null on all peers (fire-and-forget)
      peers.forEach((pc) => {
        const videoSender = pc.getSenders().find((s) => {
          if (s.track?.kind === "video") return true;
          const tx = pc.getTransceivers().find((t) => t.sender === s && t.receiver.track?.kind === "video");
          return !!tx;
        });
        if (videoSender) {
          videoSender.replaceTrack(null).catch(() => {});
        }
      });

      // Restore original mic track if we were mixing screen audio
      const savedMic = originalMicTrackRef.current;
      if (savedMic && savedMic.readyState === "live") {
        peers.forEach((pc) => {
          const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio");
          if (audioSender) {
            audioSender.replaceTrack(savedMic).catch(() => {});
          }
        });
      } else {
        // Try to restore from localStream
        const fallbackMic = localSRef.current?.getAudioTracks()[0];
        if (fallbackMic && fallbackMic.readyState === "live") {
          peers.forEach((pc) => {
            const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio");
            if (audioSender) {
              audioSender.replaceTrack(fallbackMic).catch(() => {});
            }
          });
        }
      }
      originalMicTrackRef.current = null;
      cameraTrackRef.current = null;

      // Close mixing context
      if (mixingCtxRef.current) {
        try { mixingCtxRef.current.close(); } catch {}
        mixingCtxRef.current = null;
      }

      // Exit PiP if active
      if (typeof document !== "undefined" && document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
      }

      // Notify other participants that our video/screen is off
      const s = socketRef.current;
      const uid = userIdRef.current;
      if (s && uid) {
        if (hadVideo) {
          s.emit("room-video-toggle", { roomId, userId: uid, isVideoOn: false });
        }
        if (hadScreen) {
          s.emit("room-screen-share", { roomId, userId: uid, isSharing: false });
        }
      }

      // Update participant state in context
      if (uid) {
        setParticipants((prev) =>
          prev.map((p) =>
            p.userId === uid ? { ...p, isVideoOn: false, isScreenSharing: false } : p
          )
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  //  Video ref callbacks
  // ═══════════════════════════════════════════════════════════════════

  /** Callback ref for local video — ensures srcObject is always in sync */
  const attachLocalVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoElRef.current = el;
      if (el && localVideoStreamRef.current) {
        if (el.srcObject !== localVideoStreamRef.current) {
          el.srcObject = localVideoStreamRef.current;
          el.play().catch(() => {});
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Callback ref for remote participant video */
  const attachVideoRef = useCallback(
    (userId: string, el: HTMLVideoElement | null) => {
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Re-sync local video element when layout / video state changes */
  useEffect(() => {
    const el = localVideoElRef.current;
    const stream = localVideoStreamRef.current;
    if (el && stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
        el.play().catch(() => {});
      }
    }
  }, [isVideoOn, isScreenSharing, layout, spotlightUserId]);

  /** Clear spotlight when the spotlighted user leaves */
  useEffect(() => {
    if (spotlightUserId && !participants.find((p) => p.userId === spotlightUserId)) {
      setSpotlightUserId(null);
    }
  }, [participants, spotlightUserId]);

  // ═══════════════════════════════════════════════════════════════════
  //  Toggle Camera
  // ═══════════════════════════════════════════════════════════════════

  const toggleCamera = async () => {
    if (isVideoOn) {
      // ─── Turn camera OFF ────────────────────────────────
      for (const [, pc] of peerConnectionsRef.current) {
        const videoSender = pc.getSenders().find((s) => {
          if (s.track?.kind === "video") return true;
          const tx = pc.getTransceivers().find((t) => t.sender === s && t.receiver.track?.kind === "video");
          return !!tx;
        });
        if (videoSender) {
          await videoSender.replaceTrack(null);
        }
      }

      if (localVideoTrackRef.current) {
        localVideoTrackRef.current.stop();
        localVideoTrackRef.current = null;
      }
      if (localVideoStreamRef.current) {
        localVideoStreamRef.current.getTracks().forEach((t) => t.stop());
        localVideoStreamRef.current = null;
      }
      if (localVideoElRef.current) {
        localVideoElRef.current.srcObject = null;
      }

      setIsVideoOn(false);
      setParticipants((prev) =>
        prev.map((p) => (p.userId === user?._id ? { ...p, isVideoOn: false } : p))
      );
      if (socket && roomId) {
        socket.emit("room-video-toggle", { roomId, userId: user?._id, isVideoOn: false });
      }
    } else {
      // ─── Turn camera ON ─────────────────────────────────
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const videoTrack = cameraStream.getVideoTracks()[0];
        if (!videoTrack) return;

        localVideoTrackRef.current = videoTrack;
        localVideoStreamRef.current = cameraStream;

        // Replace track on all peers AND renegotiate
        for (const [peerId, pc] of peerConnectionsRef.current) {
          const videoSender = pc.getSenders().find((s) => {
            if (s.track?.kind === "video") return true;
            const tx = pc.getTransceivers().find((t) => t.sender === s && t.receiver.track?.kind === "video");
            return !!tx;
          });
          if (videoSender) {
            await videoSender.replaceTrack(videoTrack);

            if (pc.signalingState === "stable" && socket) {
              try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit("room-signal", {
                  roomId,
                  targetUserId: peerId,
                  signal: { type: "offer", sdp: offer },
                });
              } catch (err) {
                console.error(`Failed to renegotiate with ${peerId}:`, err);
              }
            }
          }
        }

        if (localVideoElRef.current) {
          localVideoElRef.current.srcObject = cameraStream;
          localVideoElRef.current.play().catch(() => {});
        }

        setIsVideoOn(true);
        setParticipants((prev) =>
          prev.map((p) => (p.userId === user?._id ? { ...p, isVideoOn: true } : p))
        );
        if (socket && roomId) {
          socket.emit("room-video-toggle", { roomId, userId: user?._id, isVideoOn: true });
        }
      } catch (err) {
        console.error("Failed to get camera:", err);
        toast.error("Camera access denied or unavailable.");
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Toggle Screen Share
  // ═══════════════════════════════════════════════════════════════════

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      // ─── START screen sharing ───────────────────────────
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

        // Replace video track on ALL peers AND renegotiate
        for (const [peerId, pc] of peerConnectionsRef.current) {
          const videoSender = pc.getSenders().find((s) => {
            if (s.track?.kind === "video") return true;
            const tx = pc.getTransceivers().find((t) => t.sender === s && t.receiver.track?.kind === "video");
            return !!tx;
          });
          if (videoSender) {
            await videoSender.replaceTrack(screenTrack);

            if (pc.signalingState === "stable" && socket) {
              try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit("room-signal", {
                  roomId,
                  targetUserId: peerId,
                  signal: { type: "offer", sdp: offer },
                });
              } catch (err) {
                console.error(`Failed to renegotiate screen share with ${peerId}:`, err);
              }
            }
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
              const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio");
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
        setParticipants((prev) =>
          prev.map((p) =>
            p.userId === user?._id ? { ...p, isVideoOn: true, isScreenSharing: true } : p
          )
        );
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
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }

    // Restore original mic track (undo audio mixing)
    const savedMicTrack = originalMicTrackRef.current;
    for (const [, pc] of peerConnectionsRef.current) {
      const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio");
      if (audioSender) {
        if (savedMicTrack && savedMicTrack.readyState === "live") {
          await audioSender.replaceTrack(savedMicTrack);
        } else {
          const fallback = localStreamRef.current?.getAudioTracks()[0] || null;
          if (fallback && fallback.readyState === "live") {
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
    const savedCameraTrack = cameraTrackRef.current;
    if (savedCameraTrack && savedCameraTrack.readyState === "live") {
      localVideoTrackRef.current = savedCameraTrack;
      for (const [, pc] of peerConnectionsRef.current) {
        const videoSender = pc.getSenders().find((s) => {
          if (s.track?.kind === "video") return true;
          const tx = pc.getTransceivers().find((t) => t.sender === s && t.receiver.track?.kind === "video");
          return !!tx;
        });
        if (videoSender) {
          await videoSender.replaceTrack(savedCameraTrack);
        }
      }
      if (localVideoElRef.current && localVideoStreamRef.current) {
        localVideoElRef.current.srcObject = localVideoStreamRef.current;
      }
      setIsVideoOn(true);
    } else {
      // No camera was on → turn off video entirely
      for (const [, pc] of peerConnectionsRef.current) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (videoSender) {
          await videoSender.replaceTrack(null);
        }
      }
      localVideoTrackRef.current = null;
      localVideoStreamRef.current = null;
      if (localVideoElRef.current) localVideoElRef.current.srcObject = null;
      setIsVideoOn(false);
      setParticipants((prev) =>
        prev.map((p) => (p.userId === user?._id ? { ...p, isVideoOn: false } : p))
      );
      if (socket && roomId) {
        socket.emit("room-video-toggle", { roomId, userId: user?._id, isVideoOn: false });
      }
    }
    cameraTrackRef.current = null;

    setIsScreenSharing(false);
    setParticipants((prev) =>
      prev.map((p) => (p.userId === user?._id ? { ...p, isScreenSharing: false } : p))
    );
    if (socket && roomId) {
      socket.emit("room-screen-share", { roomId, userId: user?._id, isSharing: false });
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Picture-in-Picture
  // ═══════════════════════════════════════════════════════════════════

  const togglePiP = async () => {
    if (isInPiP) {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
      setIsInPiP(false);
    } else {
      const targetId =
        spotlightUserId ||
        participants.find((p) => p.isVideoOn && p.userId !== user?._id)?.userId;
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

  // ═══════════════════════════════════════════════════════════════════
  //  Leave Room
  // ═══════════════════════════════════════════════════════════════════

  const leaveRoom = () => {
    leaveVoice();
    router.push("/dashboard/members");
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Loading / not-found guards
  // ═══════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════
  //  UI
  // ═══════════════════════════════════════════════════════════════════

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
        {layout === "spotlight" ? (
          <div className="flex-1 flex flex-col pb-24 gap-4">
            {/* Main spotlight area */}
            <div className="flex-1 relative rounded-3xl overflow-hidden bg-zinc-900/40 border border-zinc-800/50 min-h-[300px]">
              {(() => {
                const currentSpotlightId =
                  spotlightUserId ||
                  participants.find((p) => p.isVideoOn || p.isScreenSharing)?.userId ||
                  participants[0]?.userId;
                const sp = participants.find((p) => p.userId === currentSpotlightId);
                if (!sp) return null;
                const isLocal = sp.userId === user?._id;
                const isSharing = sp.isScreenSharing;
                return (
                  <>
                    {sp.isVideoOn ? (
                      isLocal ? (
                        <video
                          ref={attachLocalVideoRef}
                          autoPlay
                          playsInline
                          muted
                          className={`absolute inset-0 w-full h-full bg-black ${isSharing ? "object-contain" : "object-cover"}`}
                          style={!isScreenSharing ? { transform: "scaleX(-1)" } : undefined}
                        />
                      ) : (
                        <video
                          ref={(el) => attachVideoRef(sp.userId, el)}
                          autoPlay
                          playsInline
                          muted
                          className={`absolute inset-0 w-full h-full bg-black ${isSharing ? "object-contain" : "object-cover"}`}
                        />
                      )
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="w-32 h-32 rounded-full overflow-hidden mb-4" style={{ backgroundColor: sp.color || "#27272a" }}>
                          {sp.avatar ? (
                            <img src={sp.avatar} alt={sp.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white text-5xl font-bold opacity-80">
                              {sp.name?.[0]?.toUpperCase() || "U"}
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
                        {sp.userId === user?._id && (
                          <span className="text-[10px] text-zinc-400 bg-zinc-800/80 px-1.5 py-0.5 rounded uppercase">You</span>
                        )}
                        {sp.isScreenSharing && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                            <MonitorUp className="w-3 h-3" /> Sharing
                          </span>
                        )}
                        {sp.isSpeaking && (
                          <div className="flex items-center gap-0.5 ml-1">
                            {[0, 0.1, 0.2].map((d, i) => (
                              <span
                                key={i}
                                className="w-0.5 bg-emerald-400 rounded-full"
                                style={{
                                  height: i === 1 ? "6px" : "4px",
                                  animation: "soundwave 0.6s ease-in-out infinite",
                                  animationDelay: `${d}s`,
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Speaking border */}
                    {sp.isSpeaking && (
                      <div className="absolute inset-0 rounded-3xl border-2 border-emerald-500/50 z-30 pointer-events-none" />
                    )}
                  </>
                );
              })()}
            </div>

            {/* Bottom strip — everyone EXCEPT the current spotlight user */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {(() => {
                const currentSpotlightId =
                  spotlightUserId ||
                  participants.find((p) => p.isVideoOn || p.isScreenSharing)?.userId ||
                  participants[0]?.userId;
                return participants
                  .filter((p) => p.userId !== currentSpotlightId)
                  .map((p) => (
                    <div
                      key={p.userId}
                      onClick={() => setSpotlightUserId(p.userId)}
                      className={`relative flex-shrink-0 w-28 h-28 rounded-2xl overflow-hidden bg-zinc-900/60 border cursor-pointer transition-all hover:border-zinc-600 ${
                        p.isSpeaking ? "border-emerald-500/50" : "border-zinc-800/50"
                      }`}
                    >
                      {p.isVideoOn ? (
                        p.userId === user?._id ? (
                          <video
                            ref={attachLocalVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                            style={!isScreenSharing ? { transform: "scaleX(-1)" } : undefined}
                          />
                        ) : (
                          <video
                            ref={(el) => attachVideoRef(p.userId, el)}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : (
                        <div
                          className="w-full h-full flex flex-col items-center justify-center"
                          style={{ backgroundColor: p.color || "#27272a" }}
                        >
                          {p.avatar ? (
                            <img src={p.avatar} alt={p.name} className="w-10 h-10 rounded-full object-cover" />
                          ) : (
                            <span className="text-white text-lg font-bold opacity-80">
                              {p.name?.[0]?.toUpperCase()}
                            </span>
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
                  ));
              })()}
            </div>
          </div>
        ) : (
          /* ─── GRID LAYOUT ─── */
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6 content-start pb-24">
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
                    participant.isVideoOn ? "aspect-video" : "aspect-[3/4]"
                  }`}
                >
                  {/* Video — shown when participant has video on */}
                  {participant.isVideoOn ? (
                    <>
                      {participant.userId === user?._id ? (
                        <video
                          ref={attachLocalVideoRef}
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
                          {participant.userId === user?._id && (
                            <span className="text-[9px] text-zinc-400 bg-zinc-800/80 px-1 py-0.5 rounded uppercase">You</span>
                          )}
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
                              <div
                                key={i}
                                className="w-1 bg-emerald-500 rounded-full animate-music-bar"
                                style={{ animationDelay: `${i * 0.1}s`, height: "100%" }}
                              />
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
                isMuted
                  ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                  : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
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
                isDeafened
                  ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                  : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
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
                isVideoOn && !isScreenSharing
                  ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
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
                isScreenSharing
                  ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <MonitorUp className="w-5 h-5" />}
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                {isScreenSharing ? "Stop Sharing" : "Share Screen"}
              </span>
            </button>

            {/* PiP */}
            {participants.some((p) => p.isVideoOn && p.userId !== user?._id) && (
              <button
                onClick={() => void togglePiP()}
                className={`p-3 md:p-3.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                  isInPiP
                    ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                    : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
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
              onClick={() => setLayout((l) => (l === "grid" ? "spotlight" : "grid"))}
              className="hidden sm:block p-3 md:p-3.5 rounded-xl bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-all duration-200 group relative cursor-pointer"
            >
              {layout === "grid" ? <Maximize2 className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
              <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                {layout === "grid" ? "Spotlight" : "Grid"}
              </span>
            </button>

            {/* Tools */}
            <div className="relative">
              <button
                onClick={() => setShowToolsMenu(!showToolsMenu)}
                className={`p-3 md:p-3.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                  isMusicOpen
                    ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                    : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                }`}
              >
                <Wrench className="w-5 h-5" />
                <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-950 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-zinc-800">
                  Tools
                </span>
              </button>

              {/* Tools dropdown */}
              <AnimatePresence>
                {showToolsMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-52 bg-zinc-900/95 backdrop-blur-xl border border-zinc-800/50 rounded-2xl p-2 shadow-2xl ring-1 ring-white/5 z-[60]"
                  >
                    <button
                      onClick={() => {
                        setIsMusicOpen(true);
                        setShowToolsMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm text-zinc-300 hover:text-white hover:bg-zinc-800/80 transition-all cursor-pointer"
                    >
                      <div className="p-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                        <Music className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Play Music</p>
                        <p className="text-[10px] text-zinc-500">YouTube music bot</p>
                      </div>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

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

      {/* Close tools menu on click outside */}
      {showToolsMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowToolsMenu(false)}
        />
      )}

      {/* Music Player Panel */}
      <RoomMusicPlayer
        roomId={roomId}
        isOpen={isMusicOpen}
        onClose={() => setIsMusicOpen(false)}
      />

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

