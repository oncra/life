import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const g = globalThis as unknown as { prisma?: PrismaClient };

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL must be set");
  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter, log: ["error"] });
  if (process.env.NODE_ENV !== "production") g.prisma = client;
  return client;
}

/** Lazily constructed so that importing this module (e.g. during `next build`) needs no database. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const c = g.prisma ?? (g.prisma = create());
    const v = (c as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});
