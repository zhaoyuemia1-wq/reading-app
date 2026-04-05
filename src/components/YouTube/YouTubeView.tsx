import { useState, useEffect, useCallback, useRef } from 'react';
import type { VideoEntry } from '../../types';
import * as db from '../../services/db';
import {
  extractVideoId,
  extractChannelIdentifier,
  fetchTranscript,
  fetchChannelVideos,
  summarizeWithClaude,
  makeVideoEntryId,
} from '../../services/youtube';

export default function YouTubeView() {
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [tab, setTab] = useState<'single' | 'channel'>('single');
  const [singleInput, setSingleInput] = useState('');
  const [channelInput, setChannelInput] = useState('');
  const [ytApiKey, setYtApiKey] = useState(localStorage.getItem('youtube-api-key') || '');
  const [processing, setProcessing] = useState(false);
  const [channelProgress, setChannelProgress] = useState('');
  const [channelTotal, setChannelTotal] = useState(0);
  const [channelDone, setChannelDone] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const stopRef = useRef(false);

  const claudeKey = localStorage.getItem('claude-api-key') || '';

  useEffect(() => {
    db.getVideos().then((vids) => {
      setVideos(vids.sort((a, b) => b.addedAt - a.addedAt));
    });
  }, []);

  const upsertVideo = useCallback(async (v: VideoEntry) => {
    await db.saveVideo(v);
    setVideos((prev) => {
      const idx = prev.findIndex((x) => x.id === v.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = v;
        return next;
      }
      return [v, ...prev];
    });
  }, []);

  // ── Single video ────────────────────────────────────────────
  const handleSingleVideo = async () => {
    const videoId = extractVideoId(singleInput.trim());
    if (!videoId) { alert('请输入有效的YouTube链接或视频ID'); return; }
    if (!claudeKey) { alert('请先在设置中配置 Claude API Key'); return; }

    // Check if already exists
    const existing = await db.getVideoByYouTubeId(videoId);
    if (existing && existing.status === 'done') {
      alert('这个视频已经分析过了！');
      setExpandedId(existing.id);
      return;
    }

    const entryId = makeVideoEntryId(videoId);
    const thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

    const entry: VideoEntry = {
      id: entryId,
      videoId,
      title: singleInput.trim(),
      thumbnail,
      addedAt: Date.now(),
      status: 'fetching',
    };
    await upsertVideo(entry);
    setProcessing(true);

    try {
      // Step 1: fetch transcript
      const { transcript, title } = await fetchTranscript(videoId);
      await upsertVideo({ ...entry, title: title || entry.title, transcript, status: 'analyzing' });

      if (!transcript) {
        await upsertVideo({ ...entry, title: title || entry.title, status: 'error', error: '该视频没有字幕' });
        return;
      }

      // Step 2: summarize
      const result = await summarizeWithClaude(title || entry.title, transcript, claudeKey);
      const done: VideoEntry = {
        ...entry,
        title: title || entry.title,
        transcript,
        summary: result.summary,
        keyPoints: result.keyPoints,
        timestamps: result.timestamps,
        tags: result.tags,
        analyzedAt: Date.now(),
        status: 'done',
      };
      await upsertVideo(done);
      setExpandedId(entryId);
      setSingleInput('');
    } catch (e) {
      await upsertVideo({ ...entry, status: 'error', error: String(e) });
    } finally {
      setProcessing(false);
    }
  };

  // ── Channel batch ───────────────────────────────────────────
  const handleChannelBatch = async () => {
    const ident = extractChannelIdentifier(channelInput.trim());
    if (!ident) { alert('请输入有效的YouTube频道链接，如 https://www.youtube.com/@timfletcher'); return; }
    if (!ytApiKey) { alert('请输入 YouTube API Key'); return; }
    if (!claudeKey) { alert('请先在设置中配置 Claude API Key'); return; }

    localStorage.setItem('youtube-api-key', ytApiKey);
    setProcessing(true);
    stopRef.current = false;
    setChannelProgress('正在获取频道视频列表…');
    setChannelDone(0);
    setChannelTotal(0);

    try {
      const { videos: channelVids, channelId } = await fetchChannelVideos(
        ident,
        ytApiKey,
        (_all, total, _cid) => {
          setChannelTotal(total);
          setChannelProgress(`已获取 ${_all.length} / ${total} 个视频信息…`);
        },
      );

      setChannelTotal(channelVids.length);
      setChannelProgress(`共 ${channelVids.length} 个视频，开始逐个分析…`);

      let done = 0;
      for (const meta of channelVids) {
        if (stopRef.current) break;

        // Skip if already done
        const existing = await db.getVideoByYouTubeId(meta.videoId);
        if (existing && existing.status === 'done') {
          done++;
          setChannelDone(done);
          continue;
        }

        const entryId = makeVideoEntryId(meta.videoId);
        const entry: VideoEntry = {
          id: entryId,
          videoId: meta.videoId,
          channelId,
          channelName: meta.channelTitle,
          title: meta.title,
          thumbnail: meta.thumbnail,
          publishedAt: meta.publishedAt,
          addedAt: Date.now(),
          status: 'fetching',
        };
        await upsertVideo(entry);
        setChannelProgress(`[${done + 1}/${channelVids.length}] 获取字幕：${meta.title.slice(0, 40)}…`);

        try {
          const { transcript, title } = await fetchTranscript(meta.videoId);

          if (!transcript) {
            await upsertVideo({ ...entry, title: title || entry.title, status: 'error', error: '无字幕' });
            done++;
            setChannelDone(done);
            continue;
          }

          await upsertVideo({ ...entry, title: title || entry.title, transcript, status: 'analyzing' });
          setChannelProgress(`[${done + 1}/${channelVids.length}] AI分析中：${(title || meta.title).slice(0, 40)}…`);

          const result = await summarizeWithClaude(title || meta.title, transcript, claudeKey);
          const finished: VideoEntry = {
            ...entry,
            title: title || entry.title,
            transcript,
            summary: result.summary,
            keyPoints: result.keyPoints,
            timestamps: result.timestamps,
            tags: result.tags,
            analyzedAt: Date.now(),
            status: 'done',
          };
          await upsertVideo(finished);
        } catch (e) {
          await upsertVideo({ ...entry, status: 'error', error: String(e) });
        }

        done++;
        setChannelDone(done);

        // Small delay to avoid rate limiting
        if (!stopRef.current) await new Promise((r) => setTimeout(r, 800));
      }

      setChannelProgress(stopRef.current ? '已暂停' : `✅ 完成！共处理 ${done} 个视频`);
    } catch (e) {
      setChannelProgress(`❌ 错误：${e}`);
    } finally {
      setProcessing(false);
    }
  };

  // ── Filtered video list ─────────────────────────────────────
  const filteredVideos = filterText
    ? videos.filter(
        (v) =>
          v.title.toLowerCase().includes(filterText.toLowerCase()) ||
          v.summary?.toLowerCase().includes(filterText.toLowerCase()) ||
          v.tags?.some((t) => t.toLowerCase().includes(filterText.toLowerCase())),
      )
    : videos;

  const doneCount = videos.filter((v) => v.status === 'done').length;

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: 32, borderBottom: '2px solid #1a1a1a', paddingBottom: 16 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a', fontFamily: '"Georgia","Times New Roman",serif', letterSpacing: '-0.02em' }}>
          视频总结
        </h2>
        <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 6 }}>
          YouTube 视频 AI 摘要 · 已分析 {doneCount} 个视频
        </p>
      </div>

      {/* Input Panel */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: 24, marginBottom: 32 }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f3f4f6', borderRadius: 8, padding: 3 }}>
          {([['single', '单个视频'], ['channel', '整个频道']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                background: tab === key ? '#fff' : 'transparent',
                color: tab === key ? '#1a1a1a' : '#6b7280',
                boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'single' ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              value={singleInput}
              onChange={(e) => setSingleInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !processing && handleSingleVideo()}
              placeholder="粘贴 YouTube 链接，如 https://www.youtube.com/watch?v=..."
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e5e7eb',
                fontSize: 14, outline: 'none', color: '#1a1a1a',
              }}
            />
            <button
              onClick={handleSingleVideo}
              disabled={processing || !singleInput.trim()}
              style={{
                padding: '10px 22px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: processing ? '#e5e7eb' : '#f97316', color: '#fff', fontWeight: 600, fontSize: 14,
                opacity: !singleInput.trim() ? 0.5 : 1,
              }}
            >
              {processing ? '处理中…' : '分析'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
              placeholder="频道链接，如 https://www.youtube.com/@timfletcher"
              style={{
                padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e5e7eb',
                fontSize: 14, outline: 'none', color: '#1a1a1a',
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                value={ytApiKey}
                onChange={(e) => setYtApiKey(e.target.value)}
                type="password"
                placeholder="YouTube API Key（用于获取频道视频列表）"
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e5e7eb',
                  fontSize: 14, outline: 'none', color: '#1a1a1a',
                }}
              />
              {processing ? (
                <button
                  onClick={() => { stopRef.current = true; }}
                  style={{ padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#ef4444', color: '#fff', fontWeight: 600, fontSize: 14 }}
                >
                  暂停
                </button>
              ) : (
                <button
                  onClick={handleChannelBatch}
                  disabled={!channelInput.trim() || !ytApiKey.trim()}
                  style={{
                    padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: '#f97316', color: '#fff', fontWeight: 600, fontSize: 14,
                    opacity: (!channelInput.trim() || !ytApiKey.trim()) ? 0.5 : 1,
                  }}
                >
                  开始批量分析
                </button>
              )}
            </div>

            {/* Progress bar */}
            {(processing || channelProgress) && (
              <div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{channelProgress}</div>
                {channelTotal > 0 && (
                  <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                    <div
                      style={{ height: '100%', background: '#f97316', borderRadius: 3, transition: 'width 0.4s', width: `${Math.round((channelDone / channelTotal) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Video list */}
      {videos.length > 0 && (
        <>
          {/* Filter */}
          <div style={{ marginBottom: 20 }}>
            <input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="搜索视频标题、摘要、标签…"
              style={{
                width: '100%', padding: '9px 14px', borderRadius: 10, border: '1.5px solid #e5e7eb',
                fontSize: 14, outline: 'none', color: '#1a1a1a', boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filteredVideos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                expanded={expandedId === v.id}
                onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)}
                onDelete={async () => {
                  await db.deleteVideo(v.id);
                  setVideos((prev) => prev.filter((x) => x.id !== v.id));
                }}
                onReanalyze={async () => {
                  if (!claudeKey) return;
                  const transcript = v.transcript || '';
                  if (!transcript) { alert('没有字幕，无法重新分析'); return; }
                  await upsertVideo({ ...v, status: 'analyzing' });
                  try {
                    const result = await summarizeWithClaude(v.title, transcript, claudeKey);
                    await upsertVideo({ ...v, ...result, analyzedAt: Date.now(), status: 'done' });
                  } catch (e) {
                    await upsertVideo({ ...v, status: 'error', error: String(e) });
                  }
                }}
              />
            ))}
          </div>
        </>
      )}

      {videos.length === 0 && !processing && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: '#9ca3af' }}>
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ margin: '0 auto 16px', display: 'block', opacity: 0.4 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
          <p style={{ fontSize: 15 }}>还没有视频总结</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>粘贴一个 YouTube 链接开始分析</p>
        </div>
      )}
    </div>
  );
}

// ── Video Card ────────────────────────────────────────────────
function VideoCard({
  video, expanded, onToggle, onDelete, onReanalyze,
}: {
  video: VideoEntry;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onReanalyze: () => void;
}) {
  const statusColor: Record<string, string> = {
    pending: '#9ca3af',
    fetching: '#3b82f6',
    analyzing: '#8b5cf6',
    done: '#10b981',
    error: '#ef4444',
  };
  const statusLabel: Record<string, string> = {
    pending: '等待中',
    fetching: '获取字幕…',
    analyzing: 'AI分析中…',
    done: '已完成',
    error: '失败',
  };

  const pubDate = video.publishedAt
    ? new Date(video.publishedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
    : '';

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      {/* Card header */}
      <div
        onClick={video.status === 'done' ? onToggle : undefined}
        style={{ display: 'flex', gap: 14, padding: 16, cursor: video.status === 'done' ? 'pointer' : 'default', alignItems: 'flex-start' }}
      >
        {/* Thumbnail */}
        <div style={{ flexShrink: 0, width: 120, height: 68, borderRadius: 8, overflow: 'hidden', background: '#f3f4f6' }}>
          {video.thumbnail && (
            <img src={video.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.4, margin: 0 }}>
              {video.title}
            </p>
            {/* Status dot */}
            <span style={{
              flexShrink: 0, fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
              background: statusColor[video.status] + '18', color: statusColor[video.status],
            }}>
              {statusLabel[video.status]}
            </span>
          </div>

          {pubDate && (
            <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 0' }}>{pubDate}</p>
          )}

          {/* Status spinner */}
          {(video.status === 'fetching' || video.status === 'analyzing') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <div className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {video.status === 'fetching' ? '正在获取字幕…' : 'AI 正在分析…'}
              </span>
            </div>
          )}

          {video.status === 'error' && (
            <p style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{video.error}</p>
          )}

          {/* Tags */}
          {video.status === 'done' && video.tags && video.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
              {video.tags.map((tag) => (
                <span key={tag} style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: 'rgba(249,115,22,0.1)', color: '#f97316' }}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Expand arrow */}
        {video.status === 'done' && (
          <svg
            width="16" height="16" fill="none" stroke="#9ca3af" viewBox="0 0 24 24"
            style={{ flexShrink: 0, marginTop: 2, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>

      {/* Expanded content */}
      {expanded && video.status === 'done' && (
        <div style={{ borderTop: '1px solid #f3f4f6', padding: '16px 20px', background: '#fafaf9' }}>
          {/* Summary */}
          {video.summary && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                核心摘要
              </p>
              <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7 }}>{video.summary}</p>
            </div>
          )}

          {/* Key points */}
          {video.keyPoints && video.keyPoints.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                关键要点
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {video.keyPoints.map((pt, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, fontSize: 14, color: '#374151', lineHeight: 1.5 }}>
                    <span style={{ color: '#f97316', fontWeight: 700, flexShrink: 0 }}>•</span>
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Timestamps */}
          {video.timestamps && video.timestamps.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                关键时刻
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {video.timestamps.map((ts, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <a
                      href={`https://www.youtube.com/watch?v=${video.videoId}&t=${timeToSeconds(ts.time)}s`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, fontWeight: 600, color: '#f97316', textDecoration: 'none', flexShrink: 0, fontFamily: 'monospace', background: 'rgba(249,115,22,0.08)', padding: '1px 6px', borderRadius: 4 }}
                    >
                      {ts.time}
                    </a>
                    <span style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.4 }}>{ts.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <a
              href={`https://www.youtube.com/watch?v=${video.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', textDecoration: 'none', fontWeight: 500 }}
            >
              ▶ 在YouTube打开
            </a>
            <button
              onClick={onReanalyze}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: '#f3f4f6', color: '#6b7280', border: 'none', cursor: 'pointer', fontWeight: 500 }}
            >
              重新分析
            </button>
            <button
              onClick={() => {
                if (confirm('确定删除这个视频总结吗？')) onDelete();
              }}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: '#fef2f2', color: '#ef4444', border: 'none', cursor: 'pointer', fontWeight: 500 }}
            >
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function timeToSeconds(time: string): number {
  const parts = time.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}
