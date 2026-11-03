import type { DeskSession } from "../../contract/types";
import { NOW } from "./shared.ts";

export const ok = {
  authenticated: true,
  login: "owner-demo",
  allowed: true,
  admin: true,
  server_time: NOW,
} satisfies DeskSession;

/** Signed in and allowed, but not an admin. */
export const degraded = { ...ok, admin: false } satisfies DeskSession;
