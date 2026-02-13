import mongoose, { Schema, model, models } from "mongoose";

const CallLogSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    otherUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["incoming", "outgoing", "missed"],
      required: true,
    },
    duration: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["completed", "missed", "rejected"],
      default: "completed",
    },
  },
  { timestamps: true }
);

const CallLog = models.CallLog || model("CallLog", CallLogSchema);

export default CallLog;