"use client";

import { useAuth } from "@/context/AuthContext";
import { SocketProvider } from "@/context/SocketContext";
import { CallProvider } from "@/context/CallContext";
import CallManager from "@/components/CallManager";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from 'next/link';
import { User as UserIcon, LogOut } from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.push("/");
      } else if (user.status !== "approved") {
        alert("Account not approved yet.");
        router.push("/");
      }
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) return <div className="h-screen bg-black flex items-center justify-center text-white">Loading...</div>;

  return (
    <SocketProvider>
      <CallProvider>
        <div className="min-h-screen bg-black text-white flex">
           {/* Sidebar */}
           <aside className="w-64 border-r border-zinc-800 p-6 flex flex-col justify-between hidden md:flex sticky top-0 h-screen">
              <div>
                  <h1 className="text-2xl font-bold tracking-tighter mb-10">CALLU.</h1>
                  
                  <nav className="space-y-4">
                      {/* Nav Items */}
                  </nav>
              </div>

              <div className="border-t border-zinc-800 pt-6">
                   <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center">
                          {user.avatarConfig?.image ? (
                            <img 
                              src={user.avatarConfig.image} 
                              alt={user.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-sm font-bold text-white">{user.name[0].toUpperCase()}</span>
                          )}
                      </div>
                      <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-xs text-zinc-500">Online</p>
                      </div>
                   </div>
                   <button onClick={logout} className="flex items-center gap-2 text-zinc-500 hover:text-red-400 transition-colors text-sm">
                       <LogOut size={16} /> Sign Out
                   </button>
              </div>
           </aside>
           
           <main className="flex-1 p-8 overflow-y-auto">
             {children}
           </main>

           <CallManager />
        </div>
      </CallProvider>
    </SocketProvider>
  );
}
