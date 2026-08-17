export type AppEnvironment = "development" | "production";

export const appEnvironment: AppEnvironment = import.meta.env.VITE_APP_ENV === "development"
  ? "development"
  : "production";

export const featureFlags = Object.freeze({
  petCompanion: import.meta.env.DEV
    && appEnvironment === "development"
    && import.meta.env.VITE_ENABLE_PET === "true"
});
