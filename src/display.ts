import { MODEL_EMOJI } from './config.js';

export function modelEmoji(id: string): string {
  return MODEL_EMOJI[id] ?? '';
}

export function footer(emoji: string | undefined, model: string, used: number, limit: number): string {
  const e = emoji ? `${emoji} ` : '';
  const usage = limit === 0 ? '∞/∞' : `${used}/${limit}`;
  return `-# ${e}${model}・${usage} daily・Results are AI generated`;
}
