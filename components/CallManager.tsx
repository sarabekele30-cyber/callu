"use client";
import { useEffect, useRef, useState } from "react";
import { useSocket } from "@/context/SocketContext";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";

export default function CallManager() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { outgoingCallData, setOutgoingCallData, setIsInCall } = useCall();
  
  const [incomingCall, setIncomingCall] = useState<{ from: string; name: string; avatar?: string; signal: RTCSessionDescriptionInit } | null>(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  
  const myVideo = useRef<HTMLVideoElement>(null);
  const userVideo = useRef<HTMLVideoElement>(null);
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const incomingRingtone = useRef<HTMLAudioElement | null>(null);
  const outgoingRingtone = useRef<HTMLAudioElement | null>(null);

  // Initialize audio on mount and prime them for autoplay
  useEffect(() => {
    incomingRingtone.current = new Audio("/music/callin.mp3");
    incomingRingtone.current.loop = true;
    outgoingRingtone.current = new Audio("/music/ringing.mp3");
    outgoingRingtone.current.loop = true;

    // Prime audio AND video elements to bypass autoplay policy
    const primeMedia = () => {
      // Prime ringtones
      if (incomingRingtone.current) {
        incomingRingtone.current.volume = 0.01;
        incomingRingtone.current.play().then(() => {
          incomingRingtone.current?.pause();
          if (incomingRingtone.current) {
            incomingRingtone.current.currentTime = 0;
            incomingRingtone.current.volume = 1;
          }
          console.log("✅ Incoming ringtone primed successfully");
        }).catch(() => console.log("⏸️ Incoming ringtone autoplay blocked - will prime on interaction"));
      }
      if (outgoingRingtone.current) {
        outgoingRingtone.current.volume = 0.01;
        outgoingRingtone.current.play().then(() => {
          outgoingRingtone.current?.pause();
          if (outgoingRingtone.current) {
            outgoingRingtone.current.currentTime = 0;
            outgoingRingtone.current.volume = 1;
          }
          console.log("✅ Outgoing ringtone primed successfully");
        }).catch(() => console.log("⏸️ Outgoing ringtone autoplay blocked - will prime on interaction"));
      }

      // Prime video elements for WebRTC audio
      if (userVideo.current) {
        // Create a silent stream to prime the video element
        const silentAudioContext = new AudioContext();
        const oscillator = silentAudioContext.createOscillator();
        const dst = oscillator.connect(silentAudioContext.createMediaStreamDestination());
        oscillator.start();
        const silentStream = (dst as any).stream as MediaStream;
        
        userVideo.current.srcObject = silentStream;
        userVideo.current.volume = 1;
        userVideo.current.play().then(() => {
          oscillator.stop();
          userVideo.current!.srcObject = null;
          console.log("✅ Remote video element primed for WebRTC audio");
        }).catch(() => console.log("⏸️ Remote video autoplay blocked - will prime on interaction"));
      }
    };

    // Try to prime immediately (will likely fail on first load without interaction)
    primeMedia();

    // Prime on first user interaction
    const primeOnInteraction = () => {
      console.log("🎯 User interaction detected - priming all media");
      primeMedia();
    };

    // Listen for ANY user interaction
    const events = ['click', 'touchstart', 'keydown', 'mousedown'];
    events.forEach(event => {
      document.addEventListener(event, primeOnInteraction, { once: true });
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, primeOnInteraction);
      });
    };
  }, []); 

  // Handle Socket Events for Incoming Calls
  useEffect(() => {
    if (!socket) return;

    socket.on("call-made", (data) => {
      setIncomingCall({ from: data.from, name: data.name, avatar: data.avatar, signal: data.signal });
      setIsInCall(true);
      // Play incoming ringtone
      incomingRingtone.current?.play().catch(err => console.log("Audio play failed:", err));
    });

    return () => {
      socket.off("call-made");
    };
  }, [socket, setIsInCall]);

  // Play outgoing ringtone when making a call
  useEffect(() => {
    if (outgoingCallData && !callAccepted) {
      outgoingRingtone.current?.play().catch(err => console.log("Audio play failed:", err));
    }
  }, [outgoingCallData, callAccepted]);

  // End call function (declared early so it can be used in startCall/answerCall)
  const endCall = () => {
    // Stop all ringtones
    incomingRingtone.current?.pause();
    outgoingRingtone.current?.pause();
    if (incomingRingtone.current) incomingRingtone.current.currentTime = 0;
    if (outgoingRingtone.current) outgoingRingtone.current.currentTime = 0;
    
    // Close peer connection
    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
    }
    
    // Stop all media tracks
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
      });
      setStream(null);
    }
    
    // Clear video elements
    if (myVideo.current) myVideo.current.srcObject = null;
    if (userVideo.current) userVideo.current.srcObject = null;
    
    // Reset state
    setIncomingCall(null);
    setOutgoingCallData(null);
    setCallAccepted(false);
    setIsInCall(false);
    setIsMicOn(true);
    
    // Remove socket listeners
    socket?.off("call-answered");
    socket?.off("signal-received");
  };

  const startCall = async (idToCall: string) => {
    // 1. Get Media - Audio only for voice calls
    try {
      const currentStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      setStream(currentStream);
      if (myVideo.current) myVideo.current.srcObject = currentStream;

      console.log("[CALLER] Got local stream with tracks:", currentStream.getTracks().map(t => t.kind));

      // 2. Create Peer with better ICE servers (Google STUN + Twilio TURN)
      const peer = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ]
      });
      connectionRef.current = peer;

      // Add tracks
      currentStream.getTracks().forEach(track => {
        const sender = peer.addTrack(track, currentStream);
        console.log("[CALLER] Added track:", track.kind, track.enabled);
      });

      // Monitor connection state
      peer.onconnectionstatechange = () => {
        console.log("[CALLER] Connection state:", peer.connectionState);
      };

      peer.oniceconnectionstatechange = () => {
        console.log("[CALLER] ICE connection state:", peer.iceConnectionState);
      };

      // Handle ICE
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("[CALLER] Sending ICE candidate");
          socket?.emit("send-signal", { to: idToCall, signal: { candidate: event.candidate }, from: user?._id });
        }
      };

      // Handle incoming stream from answerer
      peer.ontrack = (event) => {
        console.log("[CALLER] Received remote track:", event.track.kind, event.streams.length);
        if (userVideo.current && event.streams[0]) {
          userVideo.current.srcObject = event.streams[0];
          userVideo.current.volume = 1; // Ensure volume is set
          console.log("[CALLER] Set remote stream, tracks:", event.streams[0].getTracks().map(t => `${t.kind} enabled:${t.enabled}`));
          // Explicitly play
          userVideo.current.play().then(() => {
            console.log("✅ [CALLER] Remote audio playing - volume:", userVideo.current!.volume);
          }).catch(err => {
            console.error("❌ [CALLER] Remote audio play failed:", err);
            // Try again after a brief delay
            setTimeout(() => {
              userVideo.current?.play().catch(e => console.error("❌ [CALLER] Retry failed:", e));
            }, 100);
          });
        }
      };

      // Create Offer
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      console.log("[CALLER] Created offer");

      // Emit Call (send full offer with type and sdp)
      socket?.emit("call-user", {
        userToCall: idToCall,
        signalData: offer, // Contains both type and sdp
        from: user?._id,
        name: user?.name,
        avatar: user?.avatarConfig?.image
      });

      // Listen for Answer
      socket?.on("call-answered", async (data) => {
        console.log("[CALLER] Received answer", data.signal ? 'with signal' : 'NO SIGNAL');
        if (data.signal && data.signal.type && data.signal.sdp) {
          await peer.setRemoteDescription(new RTCSessionDescription(data.signal));
          console.log("[CALLER] Set remote description (answer)");
          // Stop outgoing ringtone when call is accepted
          outgoingRingtone.current?.pause();
          if (outgoingRingtone.current) outgoingRingtone.current.currentTime = 0;
          setCallAccepted(true);
        } else {
          console.error("[CALLER] Invalid signal data received in call-answered:", data.signal);
        }
      });

      // Listen for ICE from other side
      socket?.on("signal-received", async (data) => {
        if (data.signal.candidate) {
          console.log("[CALLER] Received ICE candidate from answerer");
          await peer.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
        }
      });

    } catch (err) {
      console.error("Failed to start call", err);
      endCall();
    }
  };

  const answerCall = async () => {
    if (!incomingCall) return;
    
    // Stop ringtones
    incomingRingtone.current?.pause();
    if (incomingRingtone.current) incomingRingtone.current.currentTime = 0;
    
    setCallAccepted(true);

    try {
       const currentStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
       setStream(currentStream);
       if (myVideo.current) myVideo.current.srcObject = currentStream;

       console.log("[ANSWERER] Got local stream with tracks:", currentStream.getTracks().map(t => t.kind));

       // Create Peer with better ICE servers
       const peer = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ]
      });
      connectionRef.current = peer;

      // Add tracks
      currentStream.getTracks().forEach(track => {
        const sender = peer.addTrack(track, currentStream);
        console.log("[ANSWERER] Added track:", track.kind, track.enabled);
      });

      // Monitor connection state
      peer.onconnectionstatechange = () => {
        console.log("[ANSWERER] Connection state:", peer.connectionState);
      };

      peer.oniceconnectionstatechange = () => {
        console.log("[ANSWERER] ICE connection state:", peer.iceConnectionState);
      };

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("[ANSWERER] Sending ICE candidate");
           socket?.emit("send-signal", { to: incomingCall.from, signal: { candidate: event.candidate }, from: user?._id });
        }
      };

      peer.ontrack = (event) => {
        console.log("[ANSWERER] Received remote track:", event.track.kind, event.streams.length);
        if (userVideo.current && event.streams[0]) {
          userVideo.current.srcObject = event.streams[0];
          userVideo.current.volume = 1; // Ensure volume is set
          console.log("[ANSWERER] Set remote stream, tracks:", event.streams[0].getTracks().map(t => `${t.kind} enabled:${t.enabled}`));
          // Explicitly play
          userVideo.current.play().then(() => {
            console.log("✅ [ANSWERER] Remote audio playing - volume:", userVideo.current!.volume);
          }).catch(err => {
            console.error("❌ [ANSWERER] Remote audio play failed:", err);
            // Try again after a brief delay
            setTimeout(() => {
              userVideo.current?.play().catch(e => console.error("❌ [ANSWERER] Retry failed:", e));
            }, 100);
          });
        }
      };

      // Set Remote from incoming
      if (incomingCall.signal && incomingCall.signal.type && incomingCall.signal.sdp) {
        console.log("[ANSWERER] Setting remote description (offer)");
        await peer.setRemoteDescription(new RTCSessionDescription(incomingCall.signal));
      } else {
        console.error("[ANSWERER] Invalid signal data in incoming call:", incomingCall.signal);
        throw new Error("Invalid call signal data");
      }

      // Create Answer
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      console.log("[ANSWERER] Created answer");

      // Emit Answer (send full answer with type and sdp)
      socket?.emit("answer-call", {
        signal: answer, // Contains both type and sdp
        to: incomingCall.from,
        from: user?._id
      });
      
      // Listen for Candidates from caller
      socket?.on("signal-received", async (data) => {
         if (data.signal.candidate) {
            console.log("[ANSWERER] Received ICE candidate from caller");
            await peer.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
         }
      });

    } catch (err) {
      console.log(err);
      endCall();
    }
  };

  // Handle Outgoing Call Trigger
  useEffect(() => {
    if (outgoingCallData && !callAccepted) {
      startCall(outgoingCallData.userId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outgoingCallData, callAccepted]);

  // UI RENDER
  if (!incomingCall && !outgoingCallData) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-8 w-full max-w-md mx-4 flex flex-col items-center relative shadow-2xl">
        
        {/* Connection Status */}
        {!callAccepted && (
          <div className="flex flex-col items-center justify-center py-8">
             {/* Show avatar for incoming call */}
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
                  <h3 className="text-2xl font-medium text-white mb-1 text-center">{incomingCall.name}</h3>
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
                  <h3 className="text-2xl font-medium text-white mb-1 text-center">{outgoingCallData?.userName}</h3>
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
              <DotLottieReact
                src="/Lotties/love.lottie"
                loop
                autoplay
              />
            </div>
            <h3 className="text-2xl font-medium text-white mb-1">{incomingCall?.name || outgoingCallData?.userName}</h3>
            <div className="flex items-center gap-2 mb-8">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-sm text-emerald-400">Connected</span>
            </div>
            
            {/* Call Controls */}
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-center gap-2">
                <button 
                  onClick={() => {
                    const audioTrack = stream?.getAudioTracks()[0];
                    if (audioTrack) {
                      audioTrack.enabled = !isMicOn;
                      setIsMicOn(!isMicOn);
                    }
                  }} 
                  className={`p-4 rounded-full transition-all cursor-pointer ${
                    !isMicOn ? 'bg-red-500 text-white shadow-lg shadow-red-500/50' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
                </button>
                <span className="text-xs text-zinc-500">{isMicOn ? 'Mute' : 'Unmute'}</span>
              </div>
              
              <div className="flex flex-col items-center gap-2">
                <button 
                  onClick={endCall} 
                  className="p-5 rounded-full bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg hover:shadow-red-500/50 cursor-pointer"
                >
                  <PhoneOff size={28} />
                </button>
                <span className="text-xs text-zinc-500">End call</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Hidden video elements for audio-only call */}
        <div className="hidden">
          <video playsInline muted ref={myVideo} autoPlay />
          <video playsInline ref={userVideo} autoPlay />
        </div>
      </div>
    </div>
  );
}
