import path from "node:path";

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

function parseAppOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_ORIGIN must be an absolute URL");
  }
  if (url.origin !== value.replace(/\/$/, "") || url.username || url.password) {
    throw new Error("APP_ORIGIN must contain only scheme, host and optional port");
  }
  return url.origin;
}

const isProduction = process.env.NODE_ENV === "production";
const databaseUrl = process.env.DATABASE_URL ?? "postgres://chatosnova:change-me@127.0.0.1:5432/chatosnova";
const appOrigin = parseAppOrigin(process.env.APP_ORIGIN ?? "http://localhost:5173");

if (isProduction) {
  if (!appOrigin.startsWith("https://")) {
    throw new Error("Production APP_ORIGIN must use HTTPS");
  }
  if (!process.env.DATABASE_URL || databaseUrl.includes("change-me")) {
    throw new Error("Production DATABASE_URL must be explicitly configured with a non-default password");
  }
}

export const config = {
  port: numberFromEnv("PORT", 3000),
  databaseUrl,
  appOrigin,
  sessionDays: numberFromEnv("SESSION_DAYS", 30),
  maxUsers: numberFromEnv("MAX_USERS", 100),
  maxUploadMb: numberFromEnv("MAX_UPLOAD_MB", 20),
  dataDir: path.resolve(process.env.DATA_DIR ?? "data"),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  isProduction,
  secureCookies: isProduction || appOrigin.startsWith("https://")
};
