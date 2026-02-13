import mongoose, { Schema, model, models } from 'mongoose';

const RoomSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  participants: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
  maxParticipants: {
    type: Number,
    default: 10,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  roomType: {
    type: String,
    enum: ['public', 'private'],
    default: 'public',
  },
}, { timestamps: true });

const Room = models.Room || model('Room', RoomSchema);

export default Room;
