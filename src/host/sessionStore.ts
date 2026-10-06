/**
 * Credential storage: the durable bearer session lives in VS Code
 * SecretStorage (global across windows). The rest of the host code talks to
 * the CredentialStore interface only.
 */

import type * as vscode from "vscode";
import type { PairedSession } from "./pairing.js";

export interface CredentialStore {
  get(): Promise<PairedSession | null>;
  save(session: PairedSession): Promise<void>;
  clear(): Promise<void>;
}

const KEY = "t3-vscode.session.v1";

export class SecretCredentialStore implements CredentialStore {
  private readonly secrets: vscode.SecretStorage;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  async get(): Promise<PairedSession | null> {
    const raw = await this.secrets.get(KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PairedSession;
      if (typeof parsed.accessToken !== "string" || typeof parsed.origin !== "string") return null;
      if (typeof parsed.expiresAt === "number" && parsed.expiresAt < Date.now() + 60_000) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async save(session: PairedSession): Promise<void> {
    await this.secrets.store(KEY, JSON.stringify(session));
  }

  async clear(): Promise<void> {
    await this.secrets.delete(KEY);
  }
}
