import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import dbConnect from "@/lib/db";
import User from "@/models/User";

const APP_URL = process.env.NEXT_PUBLIC_URL || "https://callu.onrender.com/";

export async function POST(req: Request) {
  try {
    const { targetUserId, callerId } = await req.json();

    if (!targetUserId || !callerId) {
      return NextResponse.json({ message: "Missing fields" }, { status: 400 });
    }

    if (targetUserId === callerId) {
      return NextResponse.json({ message: "Cannot notify yourself" }, { status: 400 });
    }

    await dbConnect();

    const [targetUser, callerUser] = await Promise.all([
      User.findById(targetUserId).lean(),
      User.findById(callerId).lean(),
    ]);

    if (!targetUser || !targetUser.email) {
      return NextResponse.json({ message: "Target user not found" }, { status: 404 });
    }

    if (!callerUser) {
      return NextResponse.json({ message: "Caller not found" }, { status: 404 });
    }

    if (targetUser.status !== "approved") {
      return NextResponse.json({ message: "Target user not approved" }, { status: 403 });
    }

    const {
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASS,
      SMTP_FROM,
      SMTP_SECURE,
    } = process.env;

    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
      return NextResponse.json(
        { message: "Email transport is not configured" },
        { status: 500 }
      );
    }

    const port = Number(SMTP_PORT);
    const secure = SMTP_SECURE === "true" || port === 465;
    const forceIpv4 = process.env.SMTP_FORCE_IPV4 !== "false";

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
      tls: {
        servername: SMTP_HOST,
      },
      ...(forceIpv4 ? { family: 4 } : {}),
    });

    const callerName = callerUser.name || "A member";
    const callerAvatar = callerUser.avatarConfig?.image || "";

    await transporter.sendMail({
      from: SMTP_FROM,
      to: targetUser.email,
      subject: `${callerName} is trying to reach you on CALLU`,
      text: `${callerName} tried to call you on CALLU. Open ${APP_URL} to connect and start the conversation.`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Incoming Call - CALLU</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #09090b;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #09090b; min-height: 100vh;">
            <tr>
              <td align="center" style="padding: 40px 20px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #18181b; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);">
                  
                  <!-- Header -->
                  <tr>
                    <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #27272a;">
                      <div style="display: inline-flex; align-items: center; gap: 4px; margin-bottom: 16px;">
                        <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 900; letter-spacing: -0.05em;">CALLU</h1>
                        <div style="width: 8px; height: 8px; background-color: #10b981; border-radius: 50%; margin-top: 8px;"></div>
                      </div>
                      <p style="margin: 0; color: #71717a; font-size: 14px;">The Curated Community</p>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding: 40px 32px;">
                      <!-- Caller Avatar -->
                      ${callerAvatar ? `
                      <div style="text-align: center; margin-bottom: 24px;">
                        <img src="${callerAvatar}" alt="${callerName}" style="width: 80px; height: 80px; border-radius: 50%; border: 4px solid #27272a; object-fit: cover;" />
                      </div>
                      ` : ''}
                      
                      <!-- Message -->
                      <h2 style="margin: 0 0 16px; color: #ffffff; font-size: 24px; font-weight: 600; text-align: center; line-height: 1.3;">
                        ${callerName} is trying to reach you
                      </h2>
                      <p style="margin: 0 0 32px; color: #a1a1aa; font-size: 16px; text-align: center; line-height: 1.6;">
                        A verified member wants to connect with you on CALLU. Join now to start the conversation.
                      </p>

                      <!-- CTA Button -->
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center">
                            <a href="${APP_URL}" style="display: inline-block; padding: 16px 40px; background-color: #ffffff; color: #000000; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);">
                              Join the Call
                            </a>
                          </td>
                        </tr>
                      </table>

                      <!-- Or link -->
                      <p style="margin: 24px 0 0; color: #52525b; font-size: 13px; text-align: center;">
                        Or copy this link: <a href="${APP_URL}" style="color: #10b981; text-decoration: none;">${APP_URL}</a>
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="padding: 24px 32px; background-color: #09090b; border-top: 1px solid #27272a;">
                      <p style="margin: 0 0 8px; color: #52525b; font-size: 12px; text-align: center;">
                        This is an automated notification from CALLU
                      </p>
                      <p style="margin: 0; color: #3f3f46; font-size: 11px; text-align: center;">
                        © ${new Date().getFullYear()} CALLU. All rights reserved.
                      </p>
                    </td>
                  </tr>

                </table>

                <!-- Bottom spacing -->
                <p style="margin: 24px 0 0; color: #3f3f46; font-size: 12px; text-align: center;">
                  Not expecting this email? You can safely ignore it.
                </p>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });

    return NextResponse.json({ message: "Notification sent" }, { status: 200 });
  } catch (error) {
    console.error("Notify error:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
