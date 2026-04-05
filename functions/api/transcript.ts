// Cloudflare Pages Function: proxy YouTube transcript fetching
// Available at /api/transcript?videoId=xxx

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const videoId = url.searchParams.get('videoId');

  if (!videoId) {
    return json({ error: 'Missing videoId' }, 400);
  }

  try {
    // Fetch the YouTube watch page
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,zh;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!pageRes.ok) {
      return json({ error: `YouTube returned ${pageRes.status}` }, 502);
    }

    const html = await pageRes.text();

    // Extract title from og:title or <title>
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const rawTitle = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : '';

    // Extract captionTracks from ytInitialPlayerResponse
    const captionStart = html.indexOf('"captionTracks":[');
    if (captionStart === -1) {
      return json({ error: 'No captions found for this video', transcript: '', title: rawTitle }, 200);
    }

    // Find the matching ] for the captionTracks array
    let depth = 0;
    let i = captionStart + '"captionTracks":'.length;
    const arrStart = i;
    for (; i < html.length; i++) {
      if (html[i] === '[') depth++;
      else if (html[i] === ']') {
        depth--;
        if (depth === 0) break;
      }
    }

    let captionTracks: Array<{ baseUrl: string; languageCode: string; name?: { simpleText?: string } }> = [];
    try {
      captionTracks = JSON.parse(html.slice(arrStart, i + 1));
    } catch {
      return json({ error: 'Failed to parse caption tracks', transcript: '', title: rawTitle }, 200);
    }

    if (captionTracks.length === 0) {
      return json({ error: 'No caption tracks available', transcript: '', title: rawTitle }, 200);
    }

    // Prefer English, then Chinese, then first available
    const track =
      captionTracks.find((t) => t.languageCode === 'en') ||
      captionTracks.find((t) => t.languageCode === 'en-US') ||
      captionTracks.find((t) => t.languageCode?.startsWith('zh')) ||
      captionTracks[0];

    // Fetch the caption file in json3 format
    const captionUrl = track.baseUrl + '&fmt=json3';
    const captionRes = await fetch(captionUrl);
    if (!captionRes.ok) {
      return json({ error: 'Failed to fetch captions', transcript: '', title: rawTitle }, 200);
    }

    interface CaptionEvent {
      tStartMs?: number;
      dDurationMs?: number;
      segs?: Array<{ utf8?: string }>;
    }
    const captionData: { events?: CaptionEvent[] } = await captionRes.json();
    const events = captionData.events || [];

    // Build transcript with rough timestamps every ~60s
    let transcript = '';
    let lastTimestampSec = -999;

    for (const event of events) {
      if (!event.segs) continue;
      const text = event.segs.map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
      if (!text || text === '\n') continue;

      const sec = Math.floor((event.tStartMs || 0) / 1000);
      if (sec - lastTimestampSec >= 60) {
        const mm = Math.floor(sec / 60).toString().padStart(2, '0');
        const ss = (sec % 60).toString().padStart(2, '0');
        transcript += `\n[${mm}:${ss}] `;
        lastTimestampSec = sec;
      }

      transcript += text + ' ';
    }

    transcript = transcript.trim();

    return json({
      transcript,
      title: rawTitle,
      language: track.languageCode,
      videoId,
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
