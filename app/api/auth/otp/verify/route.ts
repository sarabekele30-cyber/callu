import { NextResponse } from "next/server";
import crypto from "node:crypto";
import dbConnect from "@/lib/db";
import User from "@/models/User";
import LoginOtp from "@/models/LoginOtp";
import LoginSession from "@/models/LoginSession";

const hashValue = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

const makeToken = () => crypto.randomBytes(32).toString("hex");

export async function POST(req: Request) {
  try {
    const { email, code } = await req.json();
    if (!email || !code) {
      return NextResponse.json({ message: "Email and code are required" }, { status: 400 });
    }

    await dbConnect();
    const otp = await LoginOtp.findOne({ email });
    if (!otp) {
      return NextResponse.json({ message: "Code expired. Request a new one." }, { status: 401 });
    }

    if (otp.expiresAt.getTime() < Date.now()) {
      await LoginOtp.deleteOne({ _id: otp._id });
      return NextResponse.json({ message: "Code expired. Request a new one." }, { status: 401 });
    }

    const codeHash = hashValue(code.toString());
    if (codeHash !== otp.codeHash) {
      return NextResponse.json({ message: "Invalid verification code" }, { status: 401 });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    if (user.status !== "approved") {
      return NextResponse.json({ message: "Your application is still pending review." }, { status: 403 });
    }

    const sessionToken = makeToken();
    const tokenHash = hashValue(sessionToken);
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

    console.log(`[OTP] Creating session for user ${user.email}, expires at ${expiresAt.toISOString()}`);

    await LoginSession.create({
      userId: user._id.toString(),
      email,
      tokenHash,
      expiresAt,
    });

    await LoginOtp.deleteOne({ _id: otp._id });

    console.log(`[OTP] ✓ Session created. Token hash: ${tokenHash.substring(0, 16)}...`);
    
    // Return the full data including string version of expiresAt for localStorage
    return NextResponse.json({
      user: user.toObject ? user.toObject() : user,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
    }, { status: 200 });
  } catch (error: any) {
    console.error("OTP verify error:", error);
    return NextResponse.json({ message: error?.message || "Verification failed" }, { status: 500 });
  }
}
