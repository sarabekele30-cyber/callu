"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var RoomSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        default: '',
    },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    participants: [{
            type: mongoose_1.Schema.Types.ObjectId,
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
var Room = mongoose_1.models.Room || (0, mongoose_1.model)('Room', RoomSchema);
exports.default = Room;
