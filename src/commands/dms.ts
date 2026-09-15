import { Message, ChannelType } from 'discord.js';
import { ask } from '../providers.js';
import { recordRequest } from '../usage.js';
import { appendHistory, getLanguage } from '../store.js';
import { WHITELIST_USER_IDS } from '../config.js';
import { t } from '../strings.js';
import { extractMemory } from '../memory.js';

const BASE_TYPING_MS = 2000;
const PER_CHAR_TYPING_MS = 3;
const MAX_TYPING_MS = 6000;
const PRE_TYPING_MIN_MS = 500;
const PRE_TYPING_MAX_MS = 2000;
const INTER_MESSAGE_DELAY_MS = 800;
const IDLE_NUDGE_MS = 2 * 60 * 60 * 1000;
const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const lastInteraction = new Map<string, number>();
const lastNudge = new Map<string, number>();

function splitText(text: string): string[] {
  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= 2000) {
      chunks.push(para);
    } else {
      const lines = para.split('\n');
      let current = '';
      for (const line of lines) {
        if ((current.length + line.length + 1) > 2000 && current.length > 0) {
          chunks.push(current);
          current = line;
        } else {
          current = current ? current + '\n' + line : line;
        }
      }
      if (current) chunks.push(current);
    }
  }

  return chunks;
}

function typingDurationMs(text: string): number {
  const base = BASE_TYPING_MS + text.length * PER_CHAR_TYPING_MS;
  const jitter = base * (0.7 + Math.random() * 0.6);
  return Math.min(Math.round(jitter), MAX_TYPING_MS);
}

function preTypingDelayMs(): number {
  return PRE_TYPING_MIN_MS + Math.round(Math.random() * (PRE_TYPING_MAX_MS - PRE_TYPING_MIN_MS));
}

async function simulateTyping(channel: { sendTyping: () => Promise<void> }, durationMs: number): Promise<void> {
  const interval = 8000;
  let elapsed = 0;
  while (elapsed < durationMs) {
    await channel.sendTyping();
    const wait = Math.min(interval, durationMs - elapsed);
    await new Promise(resolve => setTimeout(resolve, wait));
    elapsed += wait;
  }
}

export async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (WHITELIST_USER_IDS.length > 0 && !WHITELIST_USER_IDS.includes(message.author.id)) return;

  const isDM = message.channel.type === ChannelType.DM;
  const botId = message.client.user.id;
  const mentionedBot = message.mentions.has(botId);

  if (!isDM && !mentionedBot) return;

  const userId = message.author.id;
  const lang = getLanguage(userId);
  lastInteraction.set(userId, Date.now());

  const question = message.content
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .trim();

  if (!question) {
    const reply = t(lang, 'emptyMention');
    if (isDM) {
      await message.channel.send(reply);
    } else {
      await message.reply({ content: reply, allowedMentions: { repliedUser: true } });
    }
    return;
  }

  try {
    const result = await ask(question, null, userId);
    recordRequest(result.provider, result.model);
    appendHistory(userId, 'user', question);
    appendHistory(userId, 'assistant', result.text);
    extractMemory(userId, question, result.text, ask).catch(() => {});

    const chunks = splitText(result.text);

    if ('sendTyping' in message.channel) {
      await new Promise(resolve => setTimeout(resolve, preTypingDelayMs()));
      const totalText = chunks.join(' ');
      const duration = typingDurationMs(totalText);
      await simulateTyping(message.channel, duration);
    }

    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        if (isDM) {
          await message.channel.send(chunks[i]);
        } else {
          await message.reply({ content: chunks[i], allowedMentions: { repliedUser: true } });
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, preTypingDelayMs()));
        if ('sendTyping' in message.channel) {
          const duration = typingDurationMs(chunks[i]);
          await simulateTyping(message.channel, duration);
        }
        await new Promise(resolve => setTimeout(resolve, INTER_MESSAGE_DELAY_MS));
        if ('send' in message.channel) {
          await message.channel.send(chunks[i]);
        }
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    try {
      if (isDM) {
        await message.channel.send(`Error: ${errorMsg}`);
      } else {
        await message.reply(`Error: ${errorMsg}`);
      }
    } catch {}
  }
}

export function checkIdleNudge(client: { users: { fetch: (id: string) => Promise<{ createDM: () => Promise<{ send: (msg: string) => Promise<unknown> }> }> } }): void {
  setInterval(async () => {
    const now = Date.now();
    for (const uid of WHITELIST_USER_IDS) {
      const last = lastInteraction.get(uid) ?? 0;
      const nudged = lastNudge.get(uid) ?? 0;
      if (now - last > IDLE_NUDGE_MS && now - nudged > NUDGE_COOLDOWN_MS && last > 0) {
        try {
          const user = await client.users.fetch(uid);
          const dm = await user.createDM();
          await dm.send('mrrp? still there? :3');
          lastNudge.set(uid, now);
        } catch {}
      }
    }
  }, 10 * 60 * 1000).unref();
}
