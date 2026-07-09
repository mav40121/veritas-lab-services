// server/rumke.ts
//
// Re-export of the Rümke manual-differential math, which now lives in
// shared/rumke.ts so the client can compute identical binomial limits for the
// live CI preview. Server code keeps importing from "./rumke" unchanged.
export * from "@shared/rumke";
