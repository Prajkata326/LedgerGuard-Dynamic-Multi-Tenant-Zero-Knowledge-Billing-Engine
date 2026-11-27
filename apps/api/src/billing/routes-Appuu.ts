import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import type { Connection } from "mongoose";
import type { Redis } from "ioredis";
import { z } from "zod";
import { getTenantConnection } from "../db/tenant-connection.js";
import { tenantModels } from "./models.js";

const chargeInput = z.object({
  amountMinor: z.number().int().positive().max(100_000_000),
  currency: z.string().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  customerId: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
}).strict();

const releaseLock = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export function billingRouter(redis: Redis) {
  const router = Router();

  router.post("/charges", async (req, res, next) => {
    const parsed = chargeInput.safeParse(req.body);
    const key = req.header("idempotency-key")?.trim();
    if (!parsed.success) return res.status(400).json({ error: "Invalid charge", details: parsed.error.flatten() });
    if (!key || key.length > 128) return res.status(400).json({ error: "A 1-128 character Idempotency-Key header is required" });

    const { organizationId, subject } = req.auth!;
    const requestHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
    const redisKey = `ledgerguard:lock:${organizationId}:${createHash("sha256").update(key).digest("hex")}`;
    const lockToken = randomUUID();
    let locked = false;
    let connection: Connection | undefined;
    try {
      locked = (await redis.set(redisKey, lockToken, "PX", 15000, "NX")) === "OK";
      if (!locked) return res.status(409).json({ error: "A request with this idempotency key is in progress; retry shortly" });

      connection = getTenantConnection(organizationId);
      await connection.asPromise();
      const { Charge, Idempotency } = tenantModels(connection);
      await Promise.all([Charge.init(), Idempotency.init()]);
      const existing = await Idempotency.findOne({ key }).lean();
      if (existing) {
        if (existing.requestHash !== requestHash) return res.status(409).json({ error: "Idempotency key was already used with a different request" });
        const charge = await Charge.findById(existing.chargeId).lean();
        if (!charge) return res.status(500).json({ error: "Idempotency record is inconsistent" });
        return res.status(200).json({ charge, replayed: true });
      }

      const session = await connection.startSession();
      let charge: Record<string, unknown> | undefined;
      try {
        await session.withTransaction(async () => {
          const [created] = await Charge.create([{ ...parsed.data, idempotencyKey: key, createdBy: subject }], { session });
          if (!created) throw new Error("Charge creation failed");
          await Idempotency.create([{ key, requestHash, chargeId: created._id }], { session });
          charge = created.toObject();
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      } finally {
        await session.endSession();
      }
      return res.status(201).json({ charge, replayed: false });
    } catch (error) {
      if (connection && typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        const { Charge, Idempotency } = tenantModels(connection);
        const existing = await Idempotency.findOne({ key }).lean();
        if (existing?.requestHash === requestHash) {
          const charge = await Charge.findById(existing.chargeId).lean();
          if (charge) return res.status(200).json({ charge, replayed: true });
        }
        if (existing) return res.status(409).json({ error: "Idempotency key was already used with a different request" });
      }
      return next(error);
    } finally {
      if (locked) await redis.eval(releaseLock, 1, redisKey, lockToken).catch(() => undefined);
    }
  });

  router.get("/summary", async (req, res, next) => {
    let connection: Connection | undefined;
    try {
      const requestedPeriod = z.enum(["24h", "7d", "30d"]).safeParse(req.query.period ?? "7d");
      if (!requestedPeriod.success) return res.status(400).json({ error: "period must be 24h, 7d, or 30d" });
      const period = requestedPeriod.data;
      const now = new Date();
      const start = new Date(now.getTime() - (period === "24h" ? 24 : period === "7d" ? 7 * 24 : 30 * 24) * 60 * 60 * 1000);
      connection = getTenantConnection(req.auth!.organizationId);
      await connection.asPromise();
      const { Charge } = tenantModels(connection);
      const match = { createdAt: { $gte: start, $lte: now } };
      const byCurrency = await Charge.aggregate([
        { $match: match },
        { $group: { _id: "$currency", chargeCount: { $sum: 1 }, totalMinor: { $sum: "$amountMinor" } } },
        { $sort: { _id: 1 } },
      ]);
      const series = await Charge.aggregate([
        { $match: match },
        { $group: {
          _id: { currency: "$currency", bucket: { $dateTrunc: { date: "$createdAt", unit: period === "24h" ? "hour" : "day", binSize: period === "24h" ? 4 : 1, startOfWeek: "monday" } } },
          chargeCount: { $sum: 1 },
          totalMinor: { $sum: "$amountMinor" },
        } },
        { $sort: { "_id.bucket": 1, "_id.currency": 1 } },
        { $project: { _id: 0, currency: "$_id.currency", bucket: "$_id.bucket", chargeCount: 1, totalMinor: 1 } },
      ]);
      return res.json({ period, currencies: byCurrency, series, chargeCount: byCurrency.reduce((sum, item) => sum + item.chargeCount, 0), generatedAt: now.toISOString() });
    } catch (error) { return next(error); }
  });

  return router;
}
