import { randomBytes } from 'node:crypto';
import { PENDING_TTL_MS, type Language } from './config.js';

export type PendingKind = 'ask' | 'factCheckPrompt' | 'replyPrompt' | 'summarizePrompt' | 'explainPrompt';

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
  messageId: string | null;
}

const pendingVisibility = new Map<string, PendingData>();

const SWEEP_MS = 10 * 60 * 1000;

export function genId(): string {
  return randomBytes(8).toString('hex');
}

export function getPendingData(id: string): PendingData | undefined {
  const data = pendingVisibility.get(id);
  if (!data) return undefined;
  if (Date.now() - data.createdAt > PENDING_TTL_MS) {
    pendingVisibility.delete(id);
    return undefined;
  }
  return data;
}

export function setPendingData(id: string, data: PendingData): void {
  pendingVisibility.set(id, data);
}

setInterval(() => {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, d] of pendingVisibility) {
    if (d.createdAt < cutoff) pendingVisibility.delete(id);
  }
}, SWEEP_MS).unref();
