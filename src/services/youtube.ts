// youtube service - VideoEntry type used by consumers of this module

// Extract YouTube video ID from URL
export function extractVideoId(input: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/, // bare ID
  ];
  for (const re of patterns) {
    const m = input.match(re);
    if (m) return m[1];
  }
  return null;
}

// Extract channel ID or @handle from URL
export function extractChannelIdentifier(input: string): { type: 'id' | 'handle'; value: string } | null {
  // youtube.com/channel/UCxxxxxxxx
  const idMatch = input.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/);
  if (idMatch) return { type: 'id', value: idMatch[1] };

  // youtube.com/@handle or just @handle
  const handleMatch = input.match(/(?:youtube\.com\/)?@([A-Za-z0-9_.-]+)/);
  if (handleMatch) return { type: 'handle', value: handleMatch[1] };

  // Bare UCxxxxxxxx channel ID
  const bareId = input.match(/^(UC[A-Za-z0-9_-]+)$/);
  if (bareId) return { type: 'id', value: bareId[1] };

  return null;
}

// Fetch transcript for a video via our Cloudflare Pages Function
export async function fetchTranscript(videoId: string): Promise<{ transcript: string; title: string; language: string }> {
  const res = await fetch(`/api/transcript?videoId=${videoId}`);
  if (!res.ok) throw new Error(`Transcript fetch failed: ${res.status}`);
  const data = await res.json();
  if (data.error && !data.transcript) throw new Error(data.error);
  return {
    transcript: data.transcript || '',
    title: data.title || '',
    language: data.language || 'en',
  };
}

export interface ChannelVideoMeta {
  videoId: string;
  title: string;
  publishedAt: string;
  channelTitle: string;
  thumbnail: string;
  description?: string;
}

// Fetch all videos from a channel (paginated)
export async function fetchChannelVideos(
  channelIdentifier: { type: 'id' | 'handle'; value: string },
  apiKey: string,
  onPage?: (videos: ChannelVideoMeta[], total: number, channelId: string) => void,
): Promise<{ videos: ChannelVideoMeta[]; channelId: string }> {
  const allVideos: ChannelVideoMeta[] = [];
  let pageToken = '';
  let resolvedChannelId = '';
  let total = 0;
  let page = 0;

  do {
    const params = new URLSearchParams({ apiKey });
    if (channelIdentifier.type === 'id') {
      params.set('channelId', channelIdentifier.value);
    } else {
      params.set('handle', channelIdentifier.value);
    }
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`/api/channel?${params.toString()}`);
    if (!res.ok) throw new Error(`Channel fetch failed: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    resolvedChannelId = data.channelId || resolvedChannelId;
    total = data.totalResults || total;
    const batch: ChannelVideoMeta[] = data.videos || [];
    allVideos.push(...batch);

    if (onPage) onPage(allVideos, total, resolvedChannelId);

    pageToken = data.nextPageToken || '';
    page++;

    // Safety: max 20 pages = 1000 videos, add small delay between pages
    if (page >= 20) break;
    if (pageToken) await new Promise((r) => setTimeout(r, 300));
  } while (pageToken);

  return { videos: allVideos, channelId: resolvedChannelId };
}

// Summarize a video transcript with Claude
export async function summarizeWithClaude(
  title: string,
  transcript: string,
  apiKey: string,
): Promise<{ summary: string; keyPoints: string[]; timestamps: { time: string; text: string }[]; tags: string[] }> {
  const truncated = transcript.slice(0, 28000); // ~7k tokens

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: `请为以下YouTube视频生成结构化总结。

视频标题：${title}

字幕内容：
${truncated}

请用以下JSON格式返回（只返回JSON，不要其他文字）：
{
  "summary": "2-4句话的核心内容摘要",
  "keyPoints": ["要点1", "要点2", "要点3", "要点4", "要点5"],
  "timestamps": [
    {"time": "00:00", "text": "这个时间点的主要内容"},
    {"time": "05:30", "text": "这个时间点的主要内容"}
  ],
  "tags": ["概念1", "概念2", "概念3"]
}

timestamps从字幕中的 [MM:SS] 标记提取3-5个关键时刻。keyPoints列出5-8个要点。`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  try {
    // Extract JSON from response (Claude might add markdown code fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]);
  } catch {
    // Fallback: return raw text as summary
    return {
      summary: text.slice(0, 500),
      keyPoints: [],
      timestamps: [],
      tags: [],
    };
  }
}

// Generate a unique internal ID for a video entry
export function makeVideoEntryId(videoId: string): string {
  return `video-${videoId}`;
}
