"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  LogOut, 
  LayoutDashboard, 
  PhoneCall, 
  Wallet, 
  Settings, 
  ChevronLeft, 
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: LayoutDashboard, label: "Overview", href: "/dashboard" },
  { icon: PhoneCall, label: "Calls", href: "/dashboard/calls" },
  { icon: Wallet, label: "Wallet", href: "/dashboard/wallet" },
  { icon: Settings, label: "Settings", href: "/dashboard/settings" },
];

export function DashboardSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { user, logout } = useAuth();

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);

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
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl transition-all group",
                "hover:bg-zinc-900/50 text-zinc-400 hover:text-white",
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
          ))}
        </nav>
      </div>

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
                    <p className="text-sm font-medium text-white truncate max-w-[120px]">{user.name}</p>
                    <p className="text-xs text-zinc-500 truncate max-w-[120px]">{user.email}</p>
                   </motion.div>
              )}
          </div>
        )}

        <button
          onClick={logout}
          className={cn(
            "flex items-center gap-3 text-red-500 hover:text-red-400 transition-colors w-full p-2 relative",
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
