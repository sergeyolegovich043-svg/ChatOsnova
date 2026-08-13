import path from "node:path";

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  port: numberFromEnv("PORT", 3000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://chatosnova:change-me@127.0.0.1:5432/chatosnova",
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  sessionDays: numberFromEnv("SESSION_DAYS", 30),
  maxUsers: numberFromEnv("MAX_USERS", 100),
  maxUploadMb: numberFromEnv("MAX_UPLOAD_MB", 20),
  dataDir: path.resolve(process.env.DATA_DIR ?? "data"),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  isProduction: process.env.NODE_ENV === "production",
  secureCookies: (process.env.APP_ORIGIN ?? "http://localhost:5173").startsWith("https://")
};
