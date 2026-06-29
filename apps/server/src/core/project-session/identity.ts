import { randomUUID } from "node:crypto";

export function newProjectSessionUuid(): string {
  return randomUUID();
}

export function newProjectSessionId(sessionUuid = newProjectSessionUuid()): string {
  return `project-session:${sessionUuid}`;
}

export function kernelAppSessionIdForProjectSession(sessionUuid: string): string {
  return `project-session:${sessionUuid}`;
}
