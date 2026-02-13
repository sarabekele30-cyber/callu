"use client";
import React, { createContext, useContext, useState } from "react";

interface CallContextType {
  callUser: (userId: string, userName: string, userAvatar?: string) => void;
  // State meant to be consumed by CallManager
  outgoingCallData: { userId: string; userName: string; userAvatar?: string } | null;
  setOutgoingCallData: (data: { userId: string; userName: string; userAvatar?: string } | null) => void;
  isInCall: boolean;
  setIsInCall: (value: boolean) => void;
}

const CallContext = createContext<CallContextType>({
  callUser: () => {},
  outgoingCallData: null,
  setOutgoingCallData: () => {},
  isInCall: false,
  setIsInCall: () => {},
});

export const CallProvider = ({ children }: { children: React.ReactNode }) => {
  const [outgoingCallData, setOutgoingCallData] = useState<{ userId: string; userName: string; userAvatar?: string } | null>(null);
  const [isInCall, setIsInCall] = useState(false);

  const callUser = (userId: string, userName: string, userAvatar?: string) => {
    if (isInCall) {
      alert("You are already in a call. Please end the current call first.");
      return;
    }
    setOutgoingCallData({ userId, userName, userAvatar });
    setIsInCall(true);
  };

  return (
    <CallContext.Provider value={{ callUser, outgoingCallData, setOutgoingCallData, isInCall, setIsInCall }}>
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => useContext(CallContext);
