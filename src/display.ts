import { MODEL_EMOJI } from './config.js';

export function modelEmoji(id: string): string {
  return MODEL_EMOJI[id] ?? '';
}

export function footer(emoji: string | undefined, model: string, used: number, limit: number): string {
  const e = emoji ? `${emoji} ` : '';
  if (limit === 0) return `-# ${e}${model}・∞ daily・Results are AI generated`;
  const remaining = Math.max(0, limit - used);
  return `-# ${e}${model}・${remaining}/${limit} daily・Results are AI generated`;
}
