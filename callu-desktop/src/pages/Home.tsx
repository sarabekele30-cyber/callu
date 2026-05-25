"use client";
import React, { useState, useEffect } from "react";
import ApplyModal, { LoginModal } from "@/components/ApplyModal";
import StyledButton from "@/components/StyledButton";
import MemberButton from "@/components/MemberButton";
import { Mic, Shield, Lock, Zap, Twitter, Linkedin, Github, Mail, Activity } from "lucide-react";
import { Footer } from "@/components/ui/modem-animated-footer";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import { LAST_ROUTE_KEY } from "../App";

export default function Home() {
  const [showApply, setShowApply] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user) {
      if (user.role === "admin") {
        navigate("/admin", { replace: true });
      } else {
        // Restore the last visited page, or default to members
        const lastRoute = localStorage.getItem(LAST_ROUTE_KEY);
        const destination =
          lastRoute && lastRoute.startsWith("/dashboard")
            ? lastRoute
            : "/dashboard/members";
        navigate(destination, { replace: true });
      }
    }
  }, [user, isLoading, navigate]);

  // Show a black splash screen while:
  // 1. Auth is still resolving (isLoading = true)
  // 2. Auth is done but user is set — navigation is queued in useEffect,
  //    so we stay on the splash to avoid flashing the landing page for a frame.
  if (isLoading || user) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4 z-50">
        <img
          src="/icon-nobg.png"
          alt="Callu"
          className="w-20 h-20 object-contain animate-pulse"
          style={{ filter: "drop-shadow(0 0 24px rgba(16,185,129,0.35))" }}
        />
      </div>
    );
  }

  return (
    <main className="bg-black text-white relative flex flex-col items-center w-full h-full overflow-y-auto">
      {/* Background Ambience */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-900/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-blue-900/10 rounded-full blur-[128px]" />
      </div>

      <nav className="relative z-10 flex justify-between items-center px-8 py-8 w-full max-w-7xl">
        <div className="flex items-center gap-1">
           <h1 className="text-3xl font-black tracking-tighter text-white">CALLU</h1>
           <div className="w-2 h-2 bg-emerald-500 rounded-full mt-3"></div>
        </div>
        <MemberButton onClick={() => setShowLogin(true)} />
      </nav>

      <div className="relative z-10 flex flex-col items-center justify-start min-h-[70vh] px-4 text-center w-full max-w-5xl pt-5">

        <h2 className="text-6xl md:text-8xl font-medium tracking-tighter mb-10 max-w-5xl text-pretty leading-[0.95] select-none">
          The curated community <br className="hidden md:block" /> for <span className="font-playfair bg-gradient-to-b from-white via-zinc-200 to-zinc-600 bg-clip-text text-transparent italic px-2 py-1 box-decoration-clone">meaningful connections.</span>
        </h2>

        <p className="font-dm text-xl md:text-2xl text-zinc-400/90 max-w-2xl mb-14 font-light leading-relaxed">
            A private space for professionals, creators, and visionaries. 
            Connect through voice, video, and serendipity.
        </p>
        
        <StyledButton onClick={() => setShowApply(true)} />

        {/* Bento Grid Teaser */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-6 gap-6 w-full max-w-6xl px-4 pb-24">
             
             {/* Card 1: Exclusive Access (Large) */}
             <div className="group col-span-1 md:col-span-4 bg-zinc-900/40 backdrop-blur-md border border-zinc-800/50 rounded-4xl py-8 pr-8 pl-6 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all duration-500 hover:-translate-y-1 cursor-default relative overflow-hidden min-h-[320px] flex flex-col justify-between text-left">
                <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full blur-[80px] -mr-16 -mt-16 transition-opacity opacity-50 group-hover:opacity-100" />
                <div className="z-10">
                   <div className="w-14 h-14 bg-zinc-800/80 rounded-2xl flex items-center justify-center mb-6 border border-zinc-700/50 group-hover:border-zinc-600 transition-colors">
                     <Lock className="text-zinc-400 group-hover:text-white transition-colors" size={24} />
                   </div>
                   <h3 className="text-3xl font-medium text-white mb-4">Exclusive Access</h3>
                   <p className="text-zinc-400 text-lg font-light max-w-md">Our community is manually curated. We accept less than 1% of applicants to ensure meaningful connections and a high-trust environment.</p>
                </div>
                {/* Visual Ornament */}
                <div className="absolute bottom-0 right-0 translate-x-12 translate-y-12 opacity-30 group-hover:opacity-50 transition-all duration-700">
                    <div className="w-48 h-48 border border-zinc-700 rounded-full flex items-center justify-center">
                        <div className="w-32 h-32 border border-zinc-600 rounded-full flex items-center justify-center">
                           <div className="w-16 h-16 bg-zinc-800 rounded-full"></div>
                        </div>
                    </div>
                </div>
             </div>
             
             {/* Card 2: Instant Connect (Small) */}
             <div className="group col-span-1 md:col-span-2 bg-zinc-900/40 backdrop-blur-md border border-zinc-800/50 rounded-4xl p-8 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all duration-500 hover:-translate-y-1 cursor-default relative overflow-hidden min-h-[320px] flex flex-col justify-between">
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-emerald-500/10 rounded-full blur-[60px] -ml-10 -mb-10 transition-opacity opacity-50 group-hover:opacity-100" />
                <div className="z-10">
                   <div className="w-14 h-14 bg-zinc-800/80 rounded-2xl flex items-center justify-center mb-6 border border-zinc-700/50 group-hover:border-zinc-600 transition-colors">
                      <Zap className="text-zinc-400 group-hover:text-white transition-colors" size={24} />
                   </div>
                   <h3 className="text-2xl font-medium text-white mb-2">Instant Connect</h3>
                   <p className="text-zinc-400 font-light">See who&apos;s online and jump into serendipitous conversations.</p>
                </div>
                <div className="flex gap-2 mt-4 ml-2">
                   <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                   <div className="w-2 h-2 rounded-full bg-emerald-500/50"></div>
                   <div className="w-2 h-2 rounded-full bg-emerald-500/20"></div>
                </div>
             </div>

             {/* Card 3: Privacy (Small) */}
             <div className="group col-span-1 md:col-span-2 bg-zinc-900/40 backdrop-blur-md border border-zinc-800/50 rounded-4xl p-8 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all duration-500 hover:-translate-y-1 cursor-default relative overflow-hidden min-h-[320px] flex flex-col justify-between">
                <div className="absolute top-0 right-0 w-40 h-40 bg-rose-500/10 rounded-full blur-[60px] -mr-10 -mt-10 transition-opacity opacity-50 group-hover:opacity-100" />
                <div className="z-10">
                   <div className="w-14 h-14 bg-zinc-800/80 rounded-2xl flex items-center justify-center mb-6 border border-zinc-700/50 group-hover:border-zinc-600 transition-colors">
                      <Shield className="text-zinc-400 group-hover:text-white transition-colors" size={24} />
                   </div>
                   <h3 className="text-2xl font-medium text-white mb-2">Private by Design</h3>
                   <p className="text-zinc-400 font-light">Your data is yours. End-to-end encrypted signals.</p>
                </div>
                {/* Visual Ornament */}
                <div className="mt-4 flex gap-1 items-center opacity-50">
                    <div className="h-1 w-8 bg-zinc-700 rounded-full"></div>
                    <div className="h-1 w-4 bg-zinc-700 rounded-full"></div>
                    <div className="h-1 w-12 bg-zinc-700 rounded-full"></div>
                </div>
             </div>

             {/* Card 4: Crystal Voice (Large) */}
             <div className="group col-span-1 md:col-span-4 bg-zinc-900/40 backdrop-blur-md border border-zinc-800/50 rounded-4xl p-8 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all duration-500 hover:-translate-y-1 cursor-default relative overflow-hidden min-h-[320px] flex flex-col justify-between">
                <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-blue-500/10 rounded-full blur-[80px] transition-opacity opacity-50 group-hover:opacity-100" />
                <div className="relative z-10">
                   <div className="w-14 h-14 bg-zinc-800/80 rounded-2xl flex items-center justify-center mb-6 border border-zinc-700/50 group-hover:border-zinc-600 transition-colors">
                     <Mic className="text-zinc-400 group-hover:text-white transition-colors" size={24} />
                   </div>
                   <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                       <div>
                           <h3 className="text-3xl font-medium text-white mb-4">Crystal Clear Audio</h3>
                           <p className="text-zinc-400 text-lg font-light max-w-md">Experience high-fidelity voice conversations that feel like you&apos;re in the same room. No lag, no noise, just pure connection.</p>
                       </div>
                       
                       {/* Audio Wave Visual */}
                       <div className="flex items-center gap-1 h-12 mb-2 opacity-60 group-hover:opacity-100 transition-opacity">
                            {[40, 60, 30, 80, 50, 90, 40, 60, 30, 50, 40, 80, 60, 30, 40].map((h, i) => (
                                <div key={i} className="w-1 bg-blue-500/80 rounded-full animate-[pulse_1s_ease-in-out_infinite]" style={{ height: `${h}%`, animationDelay: `${i * 0.1}s` }} />
                            ))}
                       </div>
                   </div>
                </div>
             </div>

        </div>

      </div>

      <Footer
        brandName="CALLU"
        brandDescription="The curated community for meaningful connections."
        socialLinks={[
          { icon: <Twitter className="w-5 h-5" />, href: "#", label: "Twitter" },
          { icon: <Linkedin className="w-5 h-5" />, href: "#", label: "LinkedIn" },
          { icon: <Github className="w-5 h-5" />, href: "#", label: "GitHub" },
          { icon: <Mail className="w-5 h-5" />, href: "#", label: "Email" },
        ]}
        navLinks={[
          { label: "Manifesto", href: "#" },
          { label: "Community", href: "#" },
          { label: "Privacy", href: "#" },
          { label: "Terms", href: "#" },
        ]}
        brandIcon={<Activity className="w-8 h-8 text-emerald-500" />}
      />

      {showApply && <ApplyModal onClose={() => setShowApply(false)} />}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </main>
  );
}
