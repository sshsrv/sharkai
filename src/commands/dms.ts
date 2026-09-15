import { Message, ChannelType } from 'discord.js';
import { ask } from '../providers.js';
import { recordRequest } from '../usage.js';
import { appendHistory, getLanguage } from '../store.js';
import { WHITELIST_USER_IDS } from '../config.js';
import { t } from '../strings.js';

const MESSAGE_DELAY_MS = 1500;
const LINE_MAX = 2000;
const FOLLOWUP_CHANCE = 0.2;
const FOLLOWUP_DELAY_MIN_MS = 5000;
const FOLLOWUP_DELAY_MAX_MS = 10000;
const IDLE_NUDGE_MS = 2 * 60 * 60 * 1000;
const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const lastInteraction = new Map<string, number>();
const lastNudge = new Map<string, number>();

const FOLLOWUPS = [
  'oh also, mrrp :3',
  'wait did i mention i like sharks? :3',
  'also you should totally try Changed btw',
  'mrrp, forgot to say :3',
  'oh wait, one more thing :3',
  'btw :3',
  '*sneaks back in* mrrp',
  'also also :3',
  'oh and another thing x3',
  'wait hold on, mreow :3',
];

function splitText(text: string): string[] {
  const raw = text.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of raw) {
    if ((current.length + line.length + 1) > LINE_MAX && current.length > 0) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function typingDurationMs(text: string): number {
  const base = 1000;
  const perChar = 5;
  return Math.min(base + text.length * perChar, 8000);
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
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping();
    }

    const result = await ask(question, null, userId);
    recordRequest(result.provider, result.model);
    appendHistory(userId, 'user', question);
    appendHistory(userId, 'assistant', result.text);

    const chunks = splitText(result.text);
    const duration = typingDurationMs(result.text);

    if ('sendTyping' in message.channel) {
      const elapsed = Date.now() - Date.now() + duration;
      const remaining = Math.max(0, duration - 1000);
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
        if ('sendTyping' in message.channel) {
          await message.channel.sendTyping();
        }
      }
    }

    if (isDM) {
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));
        }
        await message.channel.send(chunks[i]);
      }
    } else {
      let lastSent: Message | null = null;
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));
        }
        if (i === 0) {
          lastSent = await message.reply({ content: chunks[i], allowedMentions: { repliedUser: true } });
        } else if ('send' in message.channel) {
          lastSent = await message.channel.send({ content: chunks[i], allowedMentions: { repliedUser: false } });
        }
      }
    }

    if (Math.random() < FOLLOWUP_CHANCE) {
      const delay = FOLLOWUP_DELAY_MIN_MS + Math.random() * (FOLLOWUP_DELAY_MAX_MS - FOLLOWUP_DELAY_MIN_MS);
      const followup = FOLLOWUPS[Math.floor(Math.random() * FOLLOWUPS.length)];
      setTimeout(async () => {
        try {
          if ('send' in message.channel) {
            if (isDM) {
              await message.channel.send(followup);
            } else {
              await message.channel.send({ content: followup });
            }
          }
        } catch {}
      }, delay);
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
