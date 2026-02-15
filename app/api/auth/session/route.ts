import { NextResponse } from "next/server";
import crypto from "node:crypto";
import dbConnect from "@/lib/db";
import LoginSession from "@/models/LoginSession";
import User from "@/models/User";

const hashValue = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

export async function POST(req: Request) {
  try {
    const { token } = await req.json();
    if (!token) {
      console.warn("[Session] Token is missing from request");
      return NextResponse.json({ message: "Token required" }, { status: 400 });
    }

    await dbConnect();
    const tokenHash = hashValue(token);
    console.log("[Session] Looking up session with token hash:", tokenHash.substring(0, 16) + "...");
    
    const session = await LoginSession.findOne({ tokenHash });

    if (!session) {
      console.warn("[Session] Session not found for token hash:", tokenHash.substring(0, 16) + "...");
      return NextResponse.json({ message: "Session not found. Please login again." }, { status: 401 });
    }

    if (session.expiresAt.getTime() < Date.now()) {
      console.warn("[Session] Session expired for user:", session.email);
      await LoginSession.deleteOne({ _id: session._id });
      return NextResponse.json({ message: "Session expired. Please login again." }, { status: 401 });
    }

    const user = await User.findById(session.userId);
    if (!user) {
      console.error("[Session] User not found for session:", session.userId);
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    console.log("[Session] ✓ Session validated successfully for user:", user.email);
    return NextResponse.json({ user, expiresAt: session.expiresAt }, { status: 200 });
  } catch (error: any) {
    console.error("[Session] Fatal error:", error?.message, error);
    return NextResponse.json({ message: error?.message || "Session check failed" }, { status: 500 });
  }
}
