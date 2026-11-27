import { Schema } from "mongoose";

export const chargeSchema = new Schema({
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  customerId: { type: String, required: true, maxlength: 120 },
  description: { type: String, maxlength: 500 },
  idempotencyKey: { type: String, required: true },
  createdBy: { type: String, required: true },
  refundedMinor: { type: Number, default: 0, min: 0 },
}, { timestamps: true, versionKey: false });

export const idempotencySchema = new Schema({
  key: { type: String, required: true, unique: true },
  requestHash: { type: String, required: true },
  chargeId: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true, versionKey: false });

export const refundSchema = new Schema({
  chargeId: { type: Schema.Types.ObjectId, required: true, index: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  reason: { type: String, maxlength: 300 },
  idempotencyKey: { type: String, required: true },
  createdBy: { type: String, required: true },
}, { timestamps: true, versionKey: false });

export const refundIdempotencySchema = new Schema({
  key: { type: String, required: true, unique: true },
  requestHash: { type: String, required: true },
  refundId: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true, versionKey: false });

export function tenantModels(connection: import("mongoose").Connection) {
  return {
    Charge: connection.model("Charge", chargeSchema),
    Idempotency: connection.model("Idempotency", idempotencySchema),
    Refund: connection.model("Refund", refundSchema),
    RefundIdempotency: connection.model("RefundIdempotency", refundIdempotencySchema),
  };
}
