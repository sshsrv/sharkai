import { MODEL_EMOJI } from './config.js';

export function modelEmoji(id: string): string {
  return MODEL_EMOJI[id] ?? '';
}

export function footer(emoji: string | undefined, model: string, used: number, limit: number): string {
  const e = emoji ? `${emoji} ` : '';
  return `-# ${e}${model}・${used}/${limit} daily・Results are AI generated`;
}
