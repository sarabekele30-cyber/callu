"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { useCall } from "@/context/CallContext";
import { Video, Mic } from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";

interface User {
  _id: string;
  name: string;
  avatarConfig: {
    image: string;
    color: string;
  };
  email: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { onlineUsers } = useSocket();
  const { callUser } = useCall();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch("/api/users?status=approved");
        const data = await res.json();
        // Filter out self
        const others = data.users.filter((u: User) => u._id !== user?._id);
        setUsers(others);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    if (user) fetchUsers();
  }, [user]);

  const isOnline = (id: string) => onlineUsers.includes(id);
  
  // Filter to only show online users
  const onlineMembers = users.filter((u) => isOnline(u._id));

  return (
    <div className="space-y-8">
      <header>
         <h2 className="text-3xl font-light tracking-tight text-white">Community</h2>
         <p className="text-zinc-500 mt-2">
           {onlineMembers.length > 0 
             ? `${onlineMembers.length} member${onlineMembers.length !== 1 ? 's' : ''} online` 
             : 'No members online'}
         </p>
      </header>

      {/* Bento Grid or Empty State */}
      {!loading && onlineMembers.length === 0 ? (
        // Empty state - no one online
        <div className="flex flex-col items-center justify-center min-h-[500px] w-full bg-zinc-900/40 border border-zinc-800 rounded-3xl backdrop-blur-sm p-12">
          <div className="w-56 h-56 mb-8 bg-zinc-900/50 rounded-full flex items-center justify-center relative">
             <div className="absolute inset-0 bg-zinc-500/5 rounded-full blur-3xl" />
             <div className="w-full h-full -translate-y-3 -translate-x-2">
               <DotLottieReact
                src="/Lotties/nobody.lottie"
                loop
                autoplay
              />
             </div>
          </div>
          <div className="text-center space-y-3 max-w-md">
            <h3 className="text-3xl font-light text-white tracking-tight">The Lounge is Empty</h3>
            <p className="text-zinc-500 leading-relaxed font-light">It seems quiet right now. Check back later to connect with community members or invite friends.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {onlineMembers.map((member) => (
             <div key={member._id} className="group relative bg-zinc-900/40 border border-zinc-800/50 rounded-3xl p-6 backdrop-blur-sm hover:border-zinc-700/80 hover:bg-zinc-800/60 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/50">
                
                {/* Status Indicator */}
                <div className="absolute top-6 right-6 flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                       <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isOnline(member._id) ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                       <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isOnline(member._id) ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                    </span>
                </div>

                <div className="flex flex-col items-center mb-6 pt-4">
                   <div className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center bg-zinc-800 ring-4 ring-zinc-800/50 group-hover:ring-zinc-700 transition-all mb-4 shadow-lg">
                      {member.avatarConfig?.image ? (
                        <img 
                          src={member.avatarConfig.image} 
                          alt={member.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-3xl font-bold text-white">{member.name[0].toUpperCase()}</span>
                      )}
                   </div>
                   <h3 className="text-xl font-medium text-white group-hover:text-emerald-400 transition-colors">{member.name}</h3>
                   <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">Verified Member</p>
                </div>

                <div className="space-y-3">
                   <button 
                     onClick={() => callUser(member._id, member.name, member.avatarConfig?.image)}
                     className="w-full bg-white text-black hover:bg-zinc-200 py-4 rounded-2xl font-medium flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-white/5"
                     disabled={!isOnline(member._id)}
                     title={!isOnline(member._id) ? "User is offline" : "Start Voice Call"}
                   >
                      <Mic size={20} /> <span className="tracking-wide">Start Call</span>
                   </button>
                   <button className="w-full py-4 rounded-2xl bg-zinc-800/50 text-zinc-400 border border-zinc-700/30 hover:bg-zinc-800 hover:text-white hover:border-zinc-600 transition-all cursor-pointer flex items-center justify-center gap-2">
                      <Video size={20} /> <span className="tracking-wide">Video Call</span>
                   </button>
                </div>
             </div>
          ))}
          
          {loading && [1,2,3,4].map(i => (
             <div key={i} className="animate-pulse bg-zinc-900/30 border border-zinc-800 rounded-3xl p-6 h-[320px]" />
          ))}
        </div>
      )}
    </div>
  );
}
