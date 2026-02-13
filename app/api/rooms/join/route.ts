import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Room from '@/models/Room';
import User from '@/models/User';

// POST - Join a room
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

    if (!room.isActive) {
      return NextResponse.json({ message: 'Room is not active' }, { status: 403 });
    }

    // Check if user already in room
    if (room.participants.includes(userId)) {
      const populatedRoom = await Room.findById(roomId)
        .populate('createdBy', 'name avatarConfig')
        .populate('participants', 'name avatarConfig')
        .lean();
      return NextResponse.json({ room: populatedRoom }, { status: 200 });
    }

    // Check max participants
    if (room.participants.length >= room.maxParticipants) {
      return NextResponse.json({ message: 'Room is full' }, { status: 403 });
    }

    // Add user to room
    room.participants.push(userId);
    await room.save();

    const populatedRoom = await Room.findById(roomId)
      .populate('createdBy', 'name avatarConfig')
      .populate('participants', 'name avatarConfig')
      .lean();

    return NextResponse.json({ room: populatedRoom }, { status: 200 });
  } catch (error) {
    console.error('Join room error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
