// Cloudflare Pages Function: fetch all videos from a YouTube channel
// Available at /api/channel?channelId=xxx&apiKey=xxx&pageToken=xxx
// Also supports: ?handle=@timfletcher&apiKey=xxx to resolve @handles

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const apiKey = url.searchParams.get('apiKey');
  const pageToken = url.searchParams.get('pageToken') || '';
  let channelId = url.searchParams.get('channelId') || '';
  const handle = url.searchParams.get('handle') || '';

  if (!apiKey) {
    return json({ error: 'Missing apiKey' }, 400);
  }

  try {
    // Resolve @handle to channelId if needed
    if (!channelId && handle) {
      const resolveUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
      const resolveRes = await fetch(resolveUrl);
      const resolveData: { items?: Array<{ id: string }> } = await resolveRes.json();
      if (!resolveData.items || resolveData.items.length === 0) {
        return json({ error: 'Channel not found for handle: ' + handle }, 404);
      }
      channelId = resolveData.items[0].id;
    }

    if (!channelId) {
      return json({ error: 'Missing channelId or handle' }, 400);
    }

    // Fetch up to 50 videos per page from this channel
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=50&order=date&type=video&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`;

    const searchRes = await fetch(searchUrl);
    const searchData: {
      items?: Array<{
        id: { videoId: string };
        snippet: {
          title: string;
          publishedAt: string;
          channelTitle: string;
          description: string;
          thumbnails: { medium?: { url: string }; default?: { url: string } };
        };
      }>;
      nextPageToken?: string;
      pageInfo?: { totalResults: number; resultsPerPage: number };
      error?: { message: string };
    } = await searchRes.json();

    if (searchData.error) {
      return json({ error: searchData.error.message }, 502);
    }

    const videos = (searchData.items || []).map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      publishedAt: item.snippet.publishedAt,
      channelTitle: item.snippet.channelTitle,
      description: item.snippet.description?.slice(0, 200),
      thumbnail:
        item.snippet.thumbnails.medium?.url ||
        item.snippet.thumbnails.default?.url ||
        `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
    }));

    return json({
      videos,
      nextPageToken: searchData.nextPageToken || null,
      totalResults: searchData.pageInfo?.totalResults || 0,
      channelId,
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
