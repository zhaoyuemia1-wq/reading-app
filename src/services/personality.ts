import { openDB, type IDBPDatabase } from 'idb';

export interface PersonalityProfile {
  interests: string[];
  readingStyle: string;
  knowledgeAreas: string[];
  preferredDepth: 'surface' | 'medium' | 'deep';
  avoidTopics: string[];
  lastUpdated: number;
}

const PROFILE_DB_NAME = 'personality-profile';
const PROFILE_DB_VERSION = 1;
const PROFILE_STORE = 'profiles';
const PROFILE_KEY = 'current';

let profileDB: IDBPDatabase | null = null;

async function getProfileDB() {
  if (profileDB) return profileDB;
  profileDB = await openDB(PROFILE_DB_NAME, PROFILE_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE);
      }
    },
  });
  return profileDB;
}

export async function saveProfile(profile: PersonalityProfile): Promise<void> {
  const db = await getProfileDB();
  await db.put(PROFILE_STORE, profile, PROFILE_KEY);
}

export async function getProfile(): Promise<PersonalityProfile | undefined> {
  const db = await getProfileDB();
  return db.get(PROFILE_STORE, PROFILE_KEY);
}

function getUserPreferencesContext(): string {
  const interests = localStorage.getItem('reading-interests') || '';
  const goal = localStorage.getItem('reading-goal') || '';
  return `User interests: ${interests || 'not specified'}. Reading goal: ${goal || 'not specified'}.`;
}

export async function buildProfileFromClaude(apiKey: string): Promise<PersonalityProfile> {
  const context = getUserPreferencesContext();

  const prompt = `Based on the following user preferences, build a reading personality profile for this user.

User preferences: ${context}

Please respond with a JSON object (no markdown code blocks) in this exact format:
{
  "interests": ["topic1", "topic2"],
  "readingStyle": "description of reading style",
  "knowledgeAreas": ["area1", "area2"],
  "preferredDepth": "surface" | "medium" | "deep",
  "avoidTopics": ["topic1"]
}

Make reasonable inferences from the stated preferences. If preferences are sparse, use sensible defaults for a curious general reader.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json() as { content: Array<{ text: string }> };
  const text = data.content[0]?.text || '{}';

  let parsed: Omit<PersonalityProfile, 'lastUpdated'>;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Attempt to extract JSON from text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      throw new Error('Failed to parse Claude response as JSON');
    }
  }

  return {
    interests: Array.isArray(parsed.interests) ? parsed.interests : [],
    readingStyle: typeof parsed.readingStyle === 'string' ? parsed.readingStyle : 'general',
    knowledgeAreas: Array.isArray(parsed.knowledgeAreas) ? parsed.knowledgeAreas : [],
    preferredDepth: (['surface', 'medium', 'deep'].includes(parsed.preferredDepth) ? parsed.preferredDepth : 'medium') as PersonalityProfile['preferredDepth'],
    avoidTopics: Array.isArray(parsed.avoidTopics) ? parsed.avoidTopics : [],
    lastUpdated: Date.now(),
  };
}

export async function buildProfileFromOpenAI(apiKey: string): Promise<Partial<PersonalityProfile>> {
  const context = getUserPreferencesContext();

  const prompt = `Based on the following user preferences, infer a partial reading personality profile.

User preferences: ${context}

Respond with a JSON object (no markdown code blocks) with any of these fields you can reasonably infer:
{
  "interests": ["topic1", "topic2"],
  "readingStyle": "description",
  "knowledgeAreas": ["area1"],
  "preferredDepth": "surface" | "medium" | "deep",
  "avoidTopics": []
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  const text = data.choices[0]?.message?.content || '{}';

  try {
    const parsed = JSON.parse(text) as Partial<PersonalityProfile>;
    return parsed;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as Partial<PersonalityProfile>;
    }
    return {};
  }
}

export function mergeProfiles(...profiles: Array<Partial<PersonalityProfile>>): PersonalityProfile {
  const allInterests = new Set<string>();
  const allKnowledgeAreas = new Set<string>();
  const allAvoidTopics = new Set<string>();
  let readingStyle = '';
  let preferredDepth: PersonalityProfile['preferredDepth'] = 'medium';

  for (const profile of profiles) {
    if (profile.interests) profile.interests.forEach(i => allInterests.add(i));
    if (profile.knowledgeAreas) profile.knowledgeAreas.forEach(k => allKnowledgeAreas.add(k));
    if (profile.avoidTopics) profile.avoidTopics.forEach(t => allAvoidTopics.add(t));
    if (profile.readingStyle) readingStyle = profile.readingStyle;
    if (profile.preferredDepth) preferredDepth = profile.preferredDepth;
  }

  return {
    interests: Array.from(allInterests),
    readingStyle: readingStyle || 'general reader',
    knowledgeAreas: Array.from(allKnowledgeAreas),
    preferredDepth,
    avoidTopics: Array.from(allAvoidTopics),
    lastUpdated: Date.now(),
  };
}

let cachedProfile: PersonalityProfile | null = null;

export async function refreshProfile(): Promise<PersonalityProfile> {
  const claudeKey = localStorage.getItem('claude-api-key') || '';
  const openaiKey = localStorage.getItem('openai-api-key') || '';

  const partials: Array<Partial<PersonalityProfile>> = [];

  if (claudeKey) {
    try {
      const claudeProfile = await buildProfileFromClaude(claudeKey);
      partials.push(claudeProfile);
    } catch (e) {
      console.warn('Failed to build profile from Claude:', e);
    }
  }

  if (openaiKey) {
    try {
      const openaiProfile = await buildProfileFromOpenAI(openaiKey);
      partials.push(openaiProfile);
    } catch (e) {
      console.warn('Failed to build profile from OpenAI:', e);
    }
  }

  const merged = partials.length > 0
    ? mergeProfiles(...partials)
    : mergeProfiles({}); // empty defaults

  await saveProfile(merged);
  cachedProfile = merged;
  return merged;
}

export async function getPersonalityProfile(): Promise<PersonalityProfile | null> {
  if (cachedProfile) return cachedProfile;

  const stored = await getProfile();
  if (stored) {
    cachedProfile = stored;
    return stored;
  }

  // Auto-fetch if API keys are available
  const claudeKey = localStorage.getItem('claude-api-key') || '';
  const openaiKey = localStorage.getItem('openai-api-key') || '';
  if (claudeKey || openaiKey) {
    try {
      return await refreshProfile();
    } catch {
      return null;
    }
  }

  return null;
}
