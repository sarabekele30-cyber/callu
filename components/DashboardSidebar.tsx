"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  LogOut, 
  LayoutDashboard, 
  PhoneCall, 
  Settings, 
  ChevronLeft,
  ChevronDown,
  Users,
  Radio,
  Plus,
  Volume2,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";

interface Room {
  _id: string;
  name: string;
  description: string;
  participants: any[];
  maxParticipants: number;
  participantsCount?: number;
}

const navItems = [
  { 
    icon: LayoutDashboard, 
    label: "Community", 
    children: [
      { icon: Users, label: "Members", href: "/dashboard/members" },
    ]
  },
  { icon: PhoneCall, label: "Calls", href: "/dashboard/calls" },
  { icon: Settings, label: "Settings", href: "/dashboard/settings" },
];

export function DashboardSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>(["Community"]);
  const [expandedRooms, setExpandedRooms] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    maxParticipants: 10,
    roomType: "public" as "public" | "private",
  });
  const { user, logout } = useAuth();
  const { socket } = useSocket();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    try {
      const response = await fetch("/api/rooms");
      const data = await response.json();
      if (response.ok && data.rooms) {
        setRooms((prev) => data.rooms.map((room: Room) => {
          const prevRoom = prev.find((r) => r._id === room._id);
          return {
            ...room,
            participantsCount: prevRoom?.participantsCount ?? 0,
          };
        }));
      }
    } catch (error) {
      console.error("Failed to fetch rooms:", error);
    }
  };

  useEffect(() => {
    if (!socket) return;

    const handleRoomCountUpdated = (data: { roomId: string; count: number }) => {
      setRooms((prev) => prev.map((room) =>
        room._id === data.roomId ? { ...room, participantsCount: data.count } : room
      ));
    };

    socket.emit("rooms-counts-request");

    const handleRoomsCounts = (data: { counts: Array<{ roomId: string; count: number }> }) => {
      setRooms((prev) => prev.map((room) => {
        const match = data.counts.find((item) => item.roomId === room._id);
        return match ? { ...room, participantsCount: match.count } : room;
      }));
    };

    socket.on("room-count-updated", handleRoomCountUpdated);
    socket.on("rooms-counts", handleRoomsCounts);
    return () => {
      socket.off("room-count-updated", handleRoomCountUpdated);
      socket.off("rooms-counts", handleRoomsCounts);
    };
  }, [socket]);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          createdBy: user?._id,
        }),
      });

      const data = await response.json();
      if (response.ok && data.room) {
        setRooms([data.room, ...rooms]);
        setShowCreateRoomModal(false);
        setFormData({
          name: "",
          description: "",
          maxParticipants: 10,
          roomType: "public",
        });
      } else {
        alert(data.message || "Failed to create room");
      }
    } catch (error) {
      console.error("Failed to create room:", error);
      alert("Failed to create room");
    } finally {
      setCreating(false);
    }
  };

  const handleJoinRoom = async (roomId: string) => {
    // Join via WebSocket - participant management happens in the room page
    router.push(`/dashboard/rooms/${roomId}`);
  };

  const handleDeleteRoom = async (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm("Are you sure you want to delete this room? This action cannot be undone.")) {
      return;
    }

    try {
      const response = await fetch(`/api/rooms/${roomId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setRooms((prev) => prev.filter((room) => room._id !== roomId));
      } else {
        alert("Failed to delete room");
      }
    } catch (error) {
      console.error("Failed to delete room:", error);
      alert("Failed to delete room");
    }
  };

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);
  
  const toggleExpand = (label: string) => {
    setExpandedItems(prev => 
      prev.includes(label) ? prev.filter(item => item !== label) : [...prev, label]
    );
  };

  const isActive = (href?: string) => {
    if (!href) return false;
    return pathname === href || pathname?.startsWith(href + "/");
  };

  const isRoomActive = (roomId: string) => {
    return pathname === `/dashboard/rooms/${roomId}`;
  };

  return (
    <motion.aside
      initial={{ width: 256 }}
      animate={{ width: isCollapsed ? 80 : 256 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "bg-black border-r border-zinc-900 h-screen sticky top-0 hidden md:flex flex-col justify-between py-6 z-20 overflow-hidden relative"
      )}
    >
        {/* Toggle Button */}
      <button
        onClick={toggleSidebar}
        className={cn(
          "absolute p-1.5 text-zinc-400 hover:text-white transition-all z-50 focus:outline-none",
          isCollapsed 
            ? "top-20 left-1/2 -translate-x-1/2 bg-transparent hover:bg-zinc-800 rounded-md" 
            : "top-8 right-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg shadow-sm"
        )}
      >
        <ChevronLeft className={cn("w-4 h-4 transition-transform duration-300", isCollapsed && "rotate-180")} />
      </button>


      <div className={cn("flex flex-col", isCollapsed ? "items-center px-2" : "px-6")}>
        {/* Logo */}
        <div className={cn("mb-10 flex items-center h-8 relative transition-all", isCollapsed ? "justify-center" : "")}>
          {isCollapsed ? (
             <div className="flex items-center flex-col gap-1">
                <span className="text-xl font-black tracking-tighter text-white">C</span>
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
             </div>
          ) : (
             <div className="flex items-center gap-1">
                <h1 className="text-2xl font-black tracking-tighter text-white">CALLU</h1>
                <div className="w-2 h-2 bg-emerald-500 rounded-full mt-2"></div>
             </div>
          )}
        </div>

        {/* Navigation */}
        <nav className={cn("space-y-2 w-full transition-all", isCollapsed ? "mt-8" : "")}>
          {navItems.map((item) => (
            <div key={item.label}>
              {/* Parent Item */}
              {item.children ? (
                <button
                  onClick={() => !isCollapsed && toggleExpand(item.label)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-xl transition-all group w-full",
                    "hover:bg-zinc-900/50 text-zinc-400 hover:text-white",
                    isCollapsed ? "justify-center" : "justify-between"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    <AnimatePresence mode="popLayout">
                      {!isCollapsed && (
                        <motion.span
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          className="whitespace-nowrap font-medium text-sm"
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  {!isCollapsed && (
                    <ChevronDown 
                      className={cn(
                        "w-4 h-4 transition-transform flex-shrink-0",
                        expandedItems.includes(item.label) && "rotate-180"
                      )} 
                    />
                  )}
                </button>
              ) : (
                <Link
                  href={item.href!}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-xl transition-all group",
                    "hover:bg-zinc-900/50 text-zinc-400 hover:text-white",
                    isActive(item.href) && "bg-zinc-900/50 text-white",
                    isCollapsed ? "justify-center" : ""
                  )}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <AnimatePresence mode="popLayout">
                    {!isCollapsed && (
                      <motion.span
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="whitespace-nowrap font-medium text-sm"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Link>
              )}

              {/* Child Items */}
              {item.children && !isCollapsed && (
                <AnimatePresence>
                  {expandedItems.includes(item.label) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="ml-4 mt-1 space-y-1 border-l border-zinc-800 pl-4">
                        {/* Rooms Section */}
                        <div>
                          <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-zinc-900/50 text-zinc-500 hover:text-white transition-all">
                            <button
                              onClick={() => setExpandedRooms(!expandedRooms)}
                              className="flex items-center gap-3 text-sm flex-1"
                            >
                              <Radio className="w-4 h-4 flex-shrink-0" />
                              <span className="whitespace-nowrap font-medium">Rooms</span>
                              <ChevronDown 
                                className={cn(
                                  "w-3 h-3 transition-transform flex-shrink-0",
                                  expandedRooms && "rotate-180"
                                )} 
                              />
                            </button>
                            <button
                              onClick={() => setShowCreateRoomModal(true)}
                              className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-all"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Room List */}
                          <AnimatePresence>
                            {expandedRooms && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden ml-4 mt-1 space-y-1"
                              >
                                {rooms.length === 0 ? (
                                  <div className="text-xs text-zinc-600 p-2">No rooms yet</div>
                                ) : (
                                  rooms.map((room) => (
                                    <div
                                      key={room._id}
                                      className="flex items-center gap-2 group"
                                    >
                                      <button
                                        onClick={() => handleJoinRoom(room._id)}
                                        className={cn(
                                          "flex items-center gap-2 p-2 rounded-lg transition-all text-xs flex-1 text-left",
                                          "hover:bg-zinc-900/50 text-zinc-500 hover:text-white",
                                          isRoomActive(room._id) && "bg-zinc-900/50 text-white"
                                        )}
                                      >
                                        <Volume2 className="w-3 h-3 flex-shrink-0" />
                                        <span className="whitespace-nowrap font-medium truncate flex-1">
                                          {room.name}
                                        </span>
                                        <span className="text-[10px] text-zinc-600 group-hover:text-zinc-400">
                                          {room.participantsCount ?? 0}/{room.maxParticipants}
                                        </span>
                                      </button>
                                      <button
                                        onClick={(e) => handleDeleteRoom(room._id, e)}
                                        className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-red-500 hover:bg-red-500/10"
                                        title="Delete room"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ))
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* Other Children (Members, etc.) */}
                        {item.children.map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={cn(
                              "flex items-center gap-3 p-2.5 rounded-lg transition-all text-sm",
                              "hover:bg-zinc-900/50 text-zinc-500 hover:text-white",
                              isActive(child.href) && "bg-zinc-900/50 text-white"
                            )}
                          >
                            <child.icon className="w-4 h-4 flex-shrink-0" />
                            <span className="whitespace-nowrap font-medium">{child.label}</span>
                          </Link>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* Create Room Modal */}
      {showCreateRoomModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-white mb-6">
              Create New Room
            </h2>
            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Room Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
                  placeholder="My Awesome Room"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600 resize-none"
                  placeholder="What's this room about?"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Max Participants
                </label>
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={formData.maxParticipants}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      maxParticipants: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Room Type
                </label>
                <select
                  value={formData.roomType}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      roomType: e.target.value as "public" | "private",
                    })
                  }
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateRoomModal(false)}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-zinc-800 to-zinc-950 text-white rounded-lg hover:from-zinc-700 hover:to-zinc-900 transition-colors disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create Room"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={cn("border-t border-zinc-900 mt-auto", isCollapsed ? "p-4" : "p-6")}>
        {user && (
          <div className={cn("flex items-center mb-4", isCollapsed ? "justify-center" : "gap-3")}>
             <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center flex-shrink-0 border border-zinc-800">
                {user.avatarConfig?.image ? (
                  <img
                    src={user.avatarConfig.image}
                    alt={user.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-bold text-white">
                    {user.name?.[0]?.toUpperCase() || "U"}
                  </span>
                )}
              </div>
              
              {!isCollapsed && (
                   <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="overflow-hidden"
                   >
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-white truncate max-w-[100px]">{user.name}</p>
                      <img src="/Verification-Blue-Tick-PNG.webp" alt="Verified" className="w-4 h-4 flex-shrink-0" />
                    </div>
                    <p className="text-xs text-zinc-500 truncate max-w-[120px]">{user.email}</p>
                   </motion.div>
              )}
          </div>
        )}

        <button
          onClick={logout}
          className={cn(
            "flex items-center gap-3 text-red-500 hover:text-red-400 transition-colors w-full p-2 relative cursor-pointer",
            isCollapsed ? "justify-center" : ""
          )}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!isCollapsed && (
             <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm font-medium"
             >
                Logout
             </motion.span>
          )}
           
          {isCollapsed && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/80 rounded-md">
                 <span className="sr-only">Logout</span>
            </div>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
