"use client";
import React from "react";

export default function SmoothScrolling({ children }: { children: React.ReactNode }) {
  // Disabled Lenis for Electron - using native smooth scrolling instead
  return <>{children}</>;
}
