import mongoose, { type Connection } from "mongoose";
import { config } from "../config.js";

const connections = new Map<string, Connection>();

/** Resolve organizations only through the server-side registry. */
export function getTenantConnection(organizationId: string): Connection {
  const uri = config.tenantUris[organizationId];
  if (!uri) throw Object.assign(new Error("Organization is not configured"), { status: 403 });

  let connection = connections.get(organizationId);
  if (!connection) {
    connection = mongoose.createConnection(uri, {
      maxPoolSize: 20,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      appName: `ledgerguard:${organizationId}`,
    });
    connections.set(organizationId, connection);
  }
  return connection;
}

export async function closeTenantConnections() {
  await Promise.all([...connections.values()].map((connection) => connection.close()));
  connections.clear();
}
