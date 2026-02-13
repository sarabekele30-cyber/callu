import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Room from '@/models/Room';
import User from '@/models/User';

// GET - List all active rooms or get specific room
export async function GET(req: Request) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get('roomId');
    
    if (roomId) {
      // Get specific room
      const room = await Room.findById(roomId)
        .populate('createdBy', 'name avatarConfig')
        .populate('participants', 'name avatarConfig')
        .lean();
      
      if (!room) {
        return NextResponse.json({ message: 'Room not found' }, { status: 404 });
      }
      
      return NextResponse.json({ rooms: [room] }, { status: 200 });
    }
    
    // Get all active rooms
    const rooms = await Room.find({ isActive: true })
      .populate('createdBy', 'name avatarConfig')
      .populate('participants', 'name avatarConfig')
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ rooms }, { status: 200 });
  } catch (error) {
    console.error('Get rooms error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

// POST - Create new room
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { name, description, maxParticipants, roomType, createdBy } = await req.json();

    if (!name || !createdBy) {
      return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
    }

    const newRoom = await Room.create({
      name,
      description: description || '',
      maxParticipants: maxParticipants || 10,
      roomType: roomType || 'public',
      createdBy,
      participants: [], // Start empty - users join when they click
      isActive: true,
    });

    const populatedRoom = await Room.findById(newRoom._id)
      .populate('createdBy', 'name avatarConfig')
      .populate('participants', 'name avatarConfig')
      .lean();

    return NextResponse.json({ room: populatedRoom }, { status: 201 });
  } catch (error) {
    console.error('Create room error:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
