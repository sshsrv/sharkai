import fs from 'node:fs';
import path from 'node:path';

interface UserProfile {
  facts: string[];
  lastInteraction: number;
}

interface UserMemory {
  userId: string;
  summaries: string[];
  lastUpdated: number;
}

export type AskFn = (question: string, model: string | null, userId: string) => Promise<{ text: string }>;

const DATA_DIR = process.env.DATA_DIR ?? './data';
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json');

const MEMORY_EXTRACTION_INTERVAL = parseInt(process.env.MEMORY_EXTRACTION_INTERVAL ?? '20', 10) || 20;
const MAX_FACTS = 10;
const MAX_SUMMARIES = 5;

const profiles = new Map<string, UserProfile>();
const memories = new Map<string, UserMemory>();
const messageCounts = new Map<string, number>();

const SENSITIVE_PATTERNS = [
  /medical|health\s*issue|diagnos|medication|doctor|therapist/i,
  /salary|income|debt|bank\s*account|credit\s*card|financial\s*situation/i,
  /relationship\s*status|boyfriend|girlfriend|husband|wife|divorce|breakup/i,
  /password|ssn|social\s*security|credit\s*card\s*number/i,
  /mental\s*health|depression|anxiety|suicid/i,
  /age|birth\s*date|birthday/i,
  /address|phone\s*number/i,
];

function isSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(text));
}

function loadProfiles(): void {
  try {
    if (!fs.existsSync(PROFILES_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8')) as Record<string, Partial<UserProfile>>;
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === 'object') {
        profiles.set(k, {
          facts: Array.isArray(v.facts) ? v.facts : [],
          lastInteraction: typeof v.lastInteraction === 'number' ? v.lastInteraction : 0,
        });
      }
    }
  } catch (e) {
    console.warn('Failed to load profiles:', e);
  }
}

function loadMemories(): void {
  try {
    if (!fs.existsSync(MEMORIES_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf-8')) as Record<string, Partial<UserMemory>>;
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === 'object') {
        memories.set(k, {
          userId: k,
          summaries: Array.isArray(v.summaries) ? v.summaries : [],
          lastUpdated: typeof v.lastUpdated === 'number' ? v.lastUpdated : 0,
        });
      }
    }
  } catch (e) {
    console.warn('Failed to load memories:', e);
  }
}

function saveProfiles(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = Object.fromEntries(profiles.entries());
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn('Failed to save profiles:', e);
  }
}

function saveMemories(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = Object.fromEntries(memories.entries());
    fs.writeFileSync(MEMORIES_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn('Failed to save memories:', e);
  }
}

let profileDebounce: ReturnType<typeof setTimeout> | null = null;
let memoryDebounce: ReturnType<typeof setTimeout> | null = null;

function scheduleProfileSave(): void {
  if (profileDebounce !== null) clearTimeout(profileDebounce);
  profileDebounce = setTimeout(() => { profileDebounce = null; saveProfiles(); }, 500);
}

function scheduleMemorySave(): void {
  if (memoryDebounce !== null) clearTimeout(memoryDebounce);
  memoryDebounce = setTimeout(() => { memoryDebounce = null; saveMemories(); }, 500);
}

loadProfiles();
loadMemories();

function upsertProfile(userId: string): UserProfile {
  const cur = profiles.get(userId) ?? { facts: [], lastInteraction: 0 };
  profiles.set(userId, cur);
  return cur;
}

function upsertMemory(userId: string): UserMemory {
  const cur = memories.get(userId) ?? { userId, summaries: [], lastUpdated: 0 };
  memories.set(userId, cur);
  return cur;
}

function normalizeFact(fact: string): string {
  return fact.replace(/^[-*]\s*/, '').trim();
}

export function addFact(userId: string, fact: string): void {
  const cleaned = normalizeFact(fact);
  if (!cleaned || isSensitive(cleaned)) return;
  const p = upsertProfile(userId);
  if (p.facts.some(f => f.toLowerCase() === cleaned.toLowerCase())) return;
  p.facts.push(cleaned);
  if (p.facts.length > MAX_FACTS) {
    p.facts = p.facts.slice(-MAX_FACTS);
  }
  p.lastInteraction = Date.now();
  scheduleProfileSave();
}

export function addSummary(userId: string, summary: string): void {
  const cleaned = summary.trim();
  if (!cleaned || isSensitive(cleaned)) return;
  const m = upsertMemory(userId);
  m.summaries.push(cleaned);
  if (m.summaries.length > MAX_SUMMARIES) {
    m.summaries = m.summaries.slice(-MAX_SUMMARIES);
  }
  m.lastUpdated = Date.now();
  scheduleMemorySave();
}

export function getProfile(userId: string): UserProfile | null {
  return profiles.get(userId) ?? null;
}

export function getSummaries(userId: string): string[] {
  return memories.get(userId)?.summaries ?? [];
}

export function getMemoryInfo(userId: string): { facts: string[]; summaries: string[] } {
  return {
    facts: profiles.get(userId)?.facts ?? [],
    summaries: memories.get(userId)?.summaries ?? [],
  };
}

export function buildMemoryContext(userId: string): string {
  const parts: string[] = [];

  const profile = profiles.get(userId);
  if (profile && profile.facts.length > 0) {
    parts.push(`Facts about this user:\n${profile.facts.map(f => `- ${f}`).join('\n')}`);
  }

  const mem = memories.get(userId);
  if (mem && mem.summaries.length > 0) {
    parts.push(`Previous conversation topics:\n${mem.summaries.map(s => `- ${s}`).join('\n')}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}

function trackMessage(userId: string): number {
  const count = (messageCounts.get(userId) ?? 0) + 1;
  messageCounts.set(userId, count);
  return count;
}

function parseFacts(text: string): string[] {
  return text.split('\n')
    .filter(l => l.trim().startsWith('- '))
    .map(l => normalizeFact(l))
    .filter(f => f.length > 0);
}

export async function extractMemory(userId: string, question: string, answer: string, askFn: AskFn): Promise<void> {
  try {
    const count = trackMessage(userId);
    if (count % MEMORY_EXTRACTION_INTERVAL !== 0) return;

    const conversation = `User: ${question.slice(0, 500)}\nAssistant: ${answer.slice(0, 500)}`;

    const factPrompt =
      'Extract interesting facts about the user from this conversation. ' +
      'Focus on hobbies, interests, preferences, personality traits, work, projects, or anything notable. ' +
      'Do NOT include personal, medical, financial, relationship, or sensitive information. ' +
      'If there is nothing new to learn, return exactly "NONE". ' +
      'Return facts as a bullet list, one per line, starting with "- ". Max 3 facts.\n\n' +
      conversation;

    const summaryPrompt =
      'Summarize this conversation in 1-2 sentences. Focus on what was discussed, not personal details. ' +
      'Keep it brief and factual.\n\n' +
      conversation;

    const [factResult, summaryResult] = await Promise.all([
      askFn(factPrompt, null, userId).catch(() => null),
      askFn(summaryPrompt, null, userId).catch(() => null),
    ]);

    if (factResult?.text && factResult.text.trim() !== 'NONE') {
      const facts = parseFacts(factResult.text);
      for (const fact of facts.slice(0, 3)) {
        addFact(userId, fact);
      }
    }

    if (summaryResult?.text && summaryResult.text.trim()) {
      addSummary(userId, summaryResult.text.trim());
    }
  } catch {
    // Memory extraction is best-effort
  }
}
