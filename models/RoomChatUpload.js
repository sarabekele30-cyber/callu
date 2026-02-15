"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var RoomChatUploadSchema = new mongoose_1.Schema({
    roomId: { type: String, required: true, index: true },
    key: { type: String, required: true, unique: true },
    provider: { type: String, required: true, default: "imagekit" },
    fileId: { type: String, required: true },
    url: { type: String, required: true },
    contentType: { type: String },
    size: { type: Number },
    uploadedBy: { type: String },
    uploadedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    deletedAt: { type: Date },
}, { timestamps: true });
exports.default = mongoose_1.models.RoomChatUpload || (0, mongoose_1.model)("RoomChatUpload", RoomChatUploadSchema);
