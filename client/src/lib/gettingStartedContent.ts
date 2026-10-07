// client/src/lib/gettingStartedContent.ts
//
// The guide content moved to shared/gettingStartedContent.ts (parking lot #72,
// 2026-10-07) so the public Resources page, the in-app Getting Started card and
// the server endpoint that scores each step all read ONE file. This module
// re-exports it for the existing client imports.
export * from "@shared/gettingStartedContent";
