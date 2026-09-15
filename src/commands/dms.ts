import { Message, ChannelType } from 'discord.js';
import { ask } from '../providers.js';
import { recordRequest } from '../usage.js';
import { appendHistory, getLanguage } from '../store.js';
import { WHITELIST_USER_IDS } from '../config.js';
import { t } from '../strings.js';

const MESSAGE_DELAY_MS = 1500;
const LINE_MAX = 2000;
const IDLE_NUDGE_MS = 2 * 60 * 60 * 1000;
const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const lastInteraction = new Map<string, number>();
const lastNudge = new Map<string, number>();

function splitText(text: string): string[] {
  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= LINE_MAX) {
      chunks.push(para);
    } else {
      const lines = para.split('\n');
      let current = '';
      for (const line of lines) {
        if ((current.length + line.length + 1) > LINE_MAX && current.length > 0) {
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

    if (duration > 1500 && 'sendTyping' in message.channel) {
      await new Promise(resolve => setTimeout(resolve, Math.min(duration - 1000, 5000)));
      await message.channel.sendTyping();
    }

    if (isDM) {
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));
        }
        await message.channel.send(chunks[i]);
      }
    } else {
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));
        }
        if (i === 0) {
          await message.reply({ content: chunks[i], allowedMentions: { repliedUser: true } });
        } else if ('send' in message.channel) {
          await message.channel.send({ content: chunks[i] });
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
