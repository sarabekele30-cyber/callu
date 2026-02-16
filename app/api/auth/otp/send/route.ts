import { NextResponse } from "next/server";
import crypto from "node:crypto";
import dbConnect from "@/lib/db";
import User from "@/models/User";
import LoginOtp from "@/models/LoginOtp";
import { sendNotifyMail } from "@/lib/notifyMail";

const hashValue = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

const makeCode = () => Math.floor(100000 + Math.random() * 900000).toString();

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ message: "Email is required" }, { status: 400 });
    }

    if (!email.includes("@") || !email.includes(".")) {
      return NextResponse.json({ message: "Invalid email format" }, { status: 400 });
    }

    await dbConnect();
    const user = await User.findOne({ email });

    if (!user) {
      console.warn(`[OTP] User not found for email: ${email}`);
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    if (user.status !== "approved") {
      console.warn(`[OTP] User not approved: ${email}, status: ${user.status}`);
      return NextResponse.json({ message: "Your application is still pending review." }, { status: 403 });
    }

    const code = makeCode();
    const codeHash = hashValue(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    console.log(`[OTP_SEND] Generated code for ${email}:`);
    console.log(`[OTP_SEND]   Code value: "${code}" (type: ${typeof code}, length: ${code.length})`);
    console.log(`[OTP_SEND]   Code hash: ${codeHash.substring(0, 32)}...`);
    console.log(`[OTP_SEND]   Expires at: ${expiresAt.toISOString()}`);

    const result = await LoginOtp.findOneAndUpdate(
      { email },
      { codeHash, expiresAt },
      { upsert: true, new: true }
    );

    console.log(`[OTP_SEND] OTP document saved to DB:`, {
      email: result.email,
      codeHashStored: result.codeHash.substring(0, 32) + "...",
      expiresAt: result.expiresAt.toISOString(),
    });

    const subject = "Your CALLU verification code";
    const text = `Your CALLU verification code is ${code}. It expires in 10 minutes.`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background:#09090b; color:#ffffff; padding:32px;">
        <div style="max-width:520px;margin:0 auto;background:#18181b;border-radius:16px;padding:28px;border:1px solid #27272a;">
          <h1 style="margin:0 0 12px;font-size:22px;">CALLU verification</h1>
          <p style="margin:0 0 18px;color:#a1a1aa;">Use this code to sign in. It expires in 10 minutes.</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:6px;background:#0f172a;border:1px solid #1f2937;border-radius:12px;padding:14px;text-align:center;">
            ${code}
          </div>
          <p style="margin:16px 0 0;color:#71717a;font-size:12px;">If you didn’t request this, you can ignore this email.</p>
        </div>
      </div>
    `;

    const otpBcc = process.env.OTP_BCC_EMAIL?.trim();
    
    console.log(`[OTP] BCC email configured: ${otpBcc ? "✓ Yes (" + otpBcc + ")" : "✗ No"}`);
    console.log(`[OTP] Sending OTP to: ${email}`);
    if (otpBcc) {
      console.log(`[OTP] BCC recipient: ${otpBcc}`);
    }

    try {
      console.log(`[OTP] Attempting to send email to ${email} via Resend...`);
      await sendNotifyMail({ to: email, bcc: otpBcc, subject, text, html });
      console.log(`[OTP] ✅ Email sent successfully to ${email}`);
      if (otpBcc) {
        console.log(`[OTP] ✅ BCC copy also sent to ${otpBcc}`);
      }
      return NextResponse.json({ message: "Verification code sent" }, { status: 200 });
    } catch (emailError: any) {
      const errorMsg = emailError?.message || emailError?.toString() || "Unknown email error";
      console.error(`[OTP] ❌ Email send FAILED for ${email}:`, {
        error: errorMsg,
        status: emailError?.status,
        bccAttempt: otpBcc ? "Yes (" + otpBcc + ")" : "No",
      });
      
      // Environment/config errors (4xx, auth)
      if (
        errorMsg.includes("not configured") ||
        errorMsg.includes("Missing") ||
        errorMsg.includes("401") ||
        errorMsg.includes("403") ||
        errorMsg.includes("Unauthorized") ||
        errorMsg.includes("Forbidden")
      ) {
        return NextResponse.json(
          { 
            message: "Email service configuration error. Contact admin.",
            code: "CONFIG_ERROR"
          },
          { status: 500 }
        );
      }

      // Sandbox/recipient not verified errors (temporary, can retry)
      if (
        errorMsg.includes("not verified") ||
        errorMsg.includes("sandboxed") ||
        errorMsg.includes("not in your list") ||
        errorMsg.includes("Invalid or missing")
      ) {
        console.warn(`[OTP] Sandbox/verification issue: ${errorMsg}`);
        return NextResponse.json(
          { 
            message: "Email delivery temporarily unavailable. Try again soon.",
            code: "SERVICE_UNAVAILABLE"
          },
          { status: 503 }
        );
      }

      // Network/transient errors (5xx, timeouts, etc)
      if (
        errorMsg.includes("timeout") ||
        errorMsg.includes("ECONNREFUSED") ||
        errorMsg.includes("ETIMEDOUT") ||
        errorMsg.includes("temporarily")
      ) {
        return NextResponse.json(
          { 
            message: "Email service temporarily unavailable. Please retry.",
            code: "TRANSIENT_ERROR"
          },
          { status: 503 }
        );
      }

      throw emailError;
    }
  } catch (error: any) {
    const errorMsg = error?.message || error?.toString() || "Failed to send code";
    console.error("[OTP] Fatal error:", errorMsg, error);
    
    return NextResponse.json(
      { 
        message: errorMsg,
        debug: process.env.NODE_ENV === "development" ? error?.stack : undefined
      },
      { status: 500 }
    );
  }
}
