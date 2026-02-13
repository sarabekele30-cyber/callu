import { NextResponse } from "next/server";
import dbConnect from "@/lib/db";
import CallLog from "@/models/CallLog";
import User from "@/models/User";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ message: "Missing userId" }, { status: 400 });
    }

    await dbConnect();

    const ownerUser = await User.findById(userId).lean();
    if (!ownerUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    const logs = await CallLog.find({ owner: userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("otherUser", "name avatarConfig")
      .lean();

    const mapped = logs.map((log: any) => {
      const otherUser = log.otherUser || {};
      const caller = log.type === "outgoing"
        ? { name: ownerUser.name, avatar: ownerUser.avatarConfig?.image }
        : { name: otherUser.name, avatar: otherUser.avatarConfig?.image };
      const receiver = log.type === "outgoing"
        ? { name: otherUser.name, avatar: otherUser.avatarConfig?.image }
        : { name: ownerUser.name, avatar: ownerUser.avatarConfig?.image };

      return {
        _id: log._id,
        type: log.type,
        caller,
        receiver,
        duration: log.duration,
        timestamp: log.createdAt,
        status: log.status,
      };
    });

    return NextResponse.json({ logs: mapped }, { status: 200 });
  } catch (error) {
    console.error("Call logs GET error:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { ownerId, otherUserId, type, duration, status } = await req.json();

    if (!ownerId || !otherUserId || !type) {
      return NextResponse.json({ message: "Missing fields" }, { status: 400 });
    }

    await dbConnect();

    await CallLog.create({
      owner: ownerId,
      otherUser: otherUserId,
      type,
      duration: Number(duration) || 0,
      status: status || "completed",
    });

    return NextResponse.json({ message: "Logged" }, { status: 201 });
  } catch (error) {
    console.error("Call logs POST error:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}