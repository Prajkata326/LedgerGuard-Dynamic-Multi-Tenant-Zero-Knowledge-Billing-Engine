import { createPublicKey } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { jwtVerify } from "jose";
import { config, loadJwtPublicKey } from "./config.js";

declare global {
  namespace Express {
    interface Request { auth?: { subject: string; organizationId: string } }
  }
}

let publicKeyPromise: ReturnType<typeof createPublicKey> | undefined;

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Bearer token required" });
    publicKeyPromise ??= loadJwtPublicKey().then((pem) => createPublicKey(pem));
    const { payload } = await jwtVerify(header.slice(7), await publicKeyPromise, {
      algorithms: ["RS256"], issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.org !== "string" || !config.tenantUris[payload.org]) {
      return res.status(403).json({ error: "Token has no authorized organization" });
    }
    req.auth = { subject: payload.sub, organizationId: payload.org };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
