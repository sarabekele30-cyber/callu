"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var UserSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    mobile: {
        type: String,
        required: true,
        unique: true,
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    avatarConfig: {
        type: Object, // Store avatar configuration (color, generic id)
        default: {}
    }
}, { timestamps: true });
var User = mongoose_1.models.User || (0, mongoose_1.model)('User', UserSchema);
exports.default = User;
