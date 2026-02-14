"use client";

import { useAuth } from "@/context/AuthContext";
import { SocketProvider } from "@/context/SocketContext";
import { CallProvider } from "@/context/CallContext";
import CallManager from "@/components/CallManager";
import TermsModal from "@/components/TermsModal";
import CustomContextMenu from "@/components/CustomContextMenu";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Toaster, toast } from "sonner";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.push("/");
      } else if (user.status !== "approved") {
        toast.error("Account not approved yet.");
        router.push("/");
      }
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) return <div className="h-screen bg-black flex items-center justify-center text-white">Loading...</div>;

  return (
    <SocketProvider>
      <CallProvider>
        <div className="min-h-screen bg-black text-white flex">
           <DashboardSidebar />
           
           <main className="flex-1 p-8 overflow-y-auto">
             {children}
           </main>

           <CallManager />
           <TermsModal />
           <CustomContextMenu />
           <Toaster 
             position="top-center" 
             theme="dark"
             toastOptions={{
               style: {
                 background: '#18181b',
                 border: '1px solid #27272a',
                 color: '#fff',
               },
               className: 'font-dm',
             }}
           />
        </div>
      </CallProvider>
    </SocketProvider>
  );
}
