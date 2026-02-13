import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Room from '@/models/Room';
import User from '@/models/User';

// POST - Leave a room
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { roomId, userId } = await req.json();

    if (!roomId || !userId) {
      return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
    }

    const room = await Room.findById(roomId);

    if (!room) {
      return NextResponse.json({ message: 'Room not found' }, { status: 404 });
    }

    // Remove user from participants
    room.participants = room.participants.filter((id: any) => id.toString() !== userId);

    // Keep room active even when empty - like Discord channels
    // Room creator can manually delete if needed

    await room.save();

    return NextResponse.json({ message: 'Left room successfully' }, { status: 200 });
  } catch (error) {
    console.error('Leave room error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
