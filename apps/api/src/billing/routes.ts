import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import type { Connection } from "mongoose";
import type Redis from "ioredis";
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

  router.get("/charges", async (req, res, next) => {
    const query = z.object({
      page: z.coerce.number().int().min(1).max(1_000_000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Invalid pagination", details: query.error.flatten() });

    let connection: Connection | undefined;
    try {
      connection = getTenantConnection(req.auth!.organizationId);
      await connection.asPromise();
      const { Charge } = tenantModels(connection);
      const { page, limit } = query.data;
      const [total, charges] = await Promise.all([
        Charge.countDocuments({}),
        Charge.find({}).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ]);
      return res.json({
        page, limit, total, pages: Math.ceil(total / limit),
        charges: charges.map((charge) => ({
          id: String(charge._id), customerId: charge.customerId, description: charge.description ?? "Charge",
          amountMinor: charge.amountMinor, currency: charge.currency, createdAt: charge.createdAt,
        })),
      });
    } catch (error) { return next(error); }
  });

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
    const period = req.query.period === undefined ? "7d" : req.query.period;
    if (period !== "7d" && period !== "24h") return res.status(400).json({ error: "period must be 7d or 24h" });

    let connection: Connection | undefined;
    try {
      connection = getTenantConnection(req.auth!.organizationId);
      await connection.asPromise();
      const { Charge } = tenantModels(connection);

      const now = new Date();
      const start = new Date(now);
      if (period === "24h") start.setTime(now.getTime() - 24 * 60 * 60 * 1000);
      else {
        start.setUTCHours(0, 0, 0, 0);
        start.setUTCDate(start.getUTCDate() - 6);
      }

      const filter = { createdAt: { $gte: start, $lte: now } };
      const bucketId = period === "24h"
        ? { $dateTrunc: { date: "$createdAt", unit: "hour", binSize: 4, timezone: "UTC" } }
        : { $dateTrunc: { date: "$createdAt", unit: "day", timezone: "UTC" } };
      const [byCurrency, byBucket, chargeCount, customerIds, charges] = await Promise.all([
        Charge.aggregate([
          { $match: filter },
          { $group: { _id: "$currency", chargeCount: { $sum: 1 }, totalMinor: { $sum: "$amountMinor" } } },
          { $sort: { _id: 1 } },
        ]),
        Charge.aggregate([
          { $match: filter },
          { $group: { _id: { bucket: bucketId, currency: "$currency" }, chargeCount: { $sum: 1 }, totalMinor: { $sum: "$amountMinor" } } },
          { $sort: { "_id.bucket": 1 } },
        ]),
        Charge.countDocuments(filter),
        Charge.distinct("customerId", filter),
        Charge.find(filter).sort({ createdAt: -1 }).limit(8).lean(),
      ]);
      const buckets = new Map<string, { bucket: string; chargeCount: number; currencies: Record<string, number> }>();
      for (const item of byBucket) {
        const bucketKey = new Date(item._id.bucket).toISOString();
        const bucket = buckets.get(bucketKey) ?? { bucket: bucketKey, chargeCount: 0, currencies: {} };
        bucket.chargeCount += item.chargeCount;
        bucket.currencies[item._id.currency] = item.totalMinor;
        buckets.set(bucketKey, bucket);
      }
      const recentCharges = charges.map((charge) => ({
        id: String(charge._id), customerId: charge.customerId, description: charge.description ?? "Charge",
        amountMinor: charge.amountMinor, currency: charge.currency, createdAt: charge.createdAt,
      }));

      return res.json({
        organizationId: req.auth!.organizationId,
        period, start: start.toISOString(), generatedAt: now.toISOString(),
        chargeCount,
        customerCount: customerIds.length,
        currencies: byCurrency.map((item) => ({ currency: item._id, chargeCount: item.chargeCount, totalMinor: item.totalMinor })),
        timeSeries: [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
        recentCharges,
      });
    } catch (error) { return next(error); }
  });

  return router;
}
