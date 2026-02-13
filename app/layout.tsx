import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, Playfair_Display } from "next/font/google"; // Added fonts
import { AuthProvider } from "@/context/AuthContext";
import SmoothScrolling from "@/components/SmoothScrolling";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",  
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "CALLU - Exclusive Community",
  description: "A private space for professionals, creators, and visionaries. Connect through voice, video, and serendipity.",
  icons: {
    icon: '/icon',
    apple: '/apple-icon',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${dmSans.variable} ${playfair.variable} antialiased bg-black text-white`}
      >
        <AuthProvider>
          <SmoothScrolling>
            {children}
          </SmoothScrolling>
        </AuthProvider>
      </body>
    </html>
  );
}
