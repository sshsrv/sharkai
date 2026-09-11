import { randomBytes } from 'node:crypto';
import type { Language } from './config.js';

export type PendingKind = 'ask' | 'factCheckPrompt' | 'replyPrompt';

export interface PendingData {
  kind: PendingKind;
  text: string;
  targetContent: string;
  modelId: string;
  emoji: string | undefined;
  used: number;
  limit: number;
  targetMessageId: string | null;
  channelId: string;
  guildId: string | null;
  promptTemplateKey: PendingKind | null;
  originalPrompt: string;
  lang: Language;
  authorId: string;
  visible: boolean;
  createdAt: number;
}

const pendingVisibility = new Map<string, PendingData>();

const TTL_MS = 2 * 60 * 60 * 1000;
const SWEEP_MS = 10 * 60 * 1000;

export function genId(): string {
  return randomBytes(8).toString('hex');
}

export function getPendingData(id: string): PendingData | undefined {
  const data = pendingVisibility.get(id);
  if (!data) return undefined;
  if (Date.now() - data.createdAt > TTL_MS) {
    pendingVisibility.delete(id);
    return undefined;
  }
  return data;
}

export function setPendingData(id: string, data: PendingData): void {
  pendingVisibility.set(id, data);
}

setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, d] of pendingVisibility) {
    if (d.createdAt < cutoff) pendingVisibility.delete(id);
  }
}, SWEEP_MS).unref();
