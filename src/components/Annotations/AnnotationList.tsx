import { useState, useEffect, useMemo } from 'react';
import { useBooks } from '../../contexts/BookContext';
import * as db from '../../services/db';
import type { Annotation } from '../../types';

interface Props {
  bookId: string;
  bookTitle?: string;
  bookContent?: string;
  onJumpToPage?: (page: number) => void;
  onJumpToAnnotation?: (page: number, text: string) => void;
  onAnalyze?: () => void;
  analysisStatus?: { status: string; message: string } | null;
}

interface MiniMessage {
  role: 'user' | 'assistant';
  content: string;
}

function getApiKey() {
  return localStorage.getItem('claude-api-key') || '';
}

async function askAboutPassage(
  passage: string,
  bookContent: string,
  question: string,
  history: MiniMessage[],
): Promise<string> {
  const key = getApiKey();
  if (!key) return '请先在设置中填写 Claude API Key';

  const systemCtx = `你是阅读助手。用户正在读一本书，选中了这段重点内容：

"${passage}"

书籍相关背景（节选）：
${bookContent.slice(0, 4000)}

请结合这段内容和书的背景，简洁地回答用户的问题。回答控制在200字以内。`;

  const messages = [
    { role: 'user', content: systemCtx },
    { role: 'assistant', content: '好的，我已理解这段重点内容，请问您有什么问题？' },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, messages }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text || '';
}

const TYPE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  '#fbbf24': { label: '提问', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  '#60a5fa': { label: '解释', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  '#34d399': { label: '翻译', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  '#a78bfa': { label: '概念', bg: 'bg-purple-500/10', text: 'text-purple-400' },
  '#6366f1': { label: 'AI', bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
};

export default function AnnotationList({
  bookId,
  bookTitle = '',
  bookContent = '',
  onJumpToPage: _onJumpToPage,
  onJumpToAnnotation,
  onAnalyze,
  analysisStatus,
}: Props) {
  const { state, dispatch } = useBooks();
  const [dbAnnotations, setDbAnnotations] = useState<Annotation[]>([]);
  // collapsed: true = only quote shown; false (default) = note + chat visible
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openChat, setOpenChat] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, MiniMessage[]>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    db.getAnnotations(bookId).then(all => setDbAnnotations(all));
  }, [bookId]);

  const annotations = useMemo(() => {
    const contextForBook = state.annotations.filter(a => a.bookId === bookId);
    const merged = new Map<string, Annotation>();
    for (const a of dbAnnotations) merged.set(a.id, a);
    for (const a of contextForBook) merged.set(a.id, a);
    return Array.from(merged.values()).sort(
      (a, b) => (a.page || 999) - (b.page || 999) || a.createdAt - b.createdAt,
    );
  }, [dbAnnotations, state.annotations, bookId]);

  const handleDelete = async (id: string) => {
    await db.deleteAnnotation(id);
    setDbAnnotations(prev => prev.filter(a => a.id !== id));
    dispatch({ type: 'REMOVE_ANNOTATION', payload: id });
  };

  const handleExport = () => {
    const title = bookTitle || bookId;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // 2026-04-04
    const dateTimeStr = now.toLocaleString('zh-CN');

    // ── YAML frontmatter (Obsidian reads this) ──────────────────
    const aiSummaryAnn = annotations.find(a => a.isAI && a.text.startsWith('【全书核心】'));
    const aiSummary = aiSummaryAnn?.note?.replace(/^📖 全书总结：/, '') || '';
    const aiInsight = aiSummaryAnn?.text?.replace(/^【全书核心】/, '') || '';

    const typeLabel = (color: string) => {
      const map: Record<string, string> = {
        '#fbbf24': '洞察', '#60a5fa': '行动', '#34d399': '翻译',
        '#a78bfa': '概念', '#6366f1': 'AI分析',
      };
      return map[color] || '标注';
    };

    // Collect unique tags from annotation types
    const tagSet = new Set<string>();
    annotations.forEach(a => tagSet.add(typeLabel(a.color)));
    const tags = [...tagSet].map(t => `  - ${t}`).join('\n');

    const frontmatter = `---
title: "${title}"
date: ${dateStr}
tags:
  - 读书笔记
${tags}
source: 阅读助手
---`;

    // ── AI Summary section ──────────────────────────────────────
    const summarySection = aiSummary ? `
## 📖 全书总结

${aiSummary}

> **核心洞见**：${aiInsight}
` : '';

    // ── Mind map section ────────────────────────────────────────
    const mindMapRaw = localStorage.getItem(`mindmap_${bookId}`);
    let mindMapSection = '';
    if (mindMapRaw) {
      try {
        const renderTree = (
          node: { name: string; children?: { name: string; children?: unknown[] }[] },
          depth = 0,
        ): string => {
          const indent = '\t'.repeat(depth);
          const lines = [`${indent}- ${node.name}`];
          if (node.children) {
            for (const child of node.children)
              lines.push(renderTree(child as { name: string; children?: { name: string; children?: unknown[] }[] }, depth + 1));
          }
          return lines.join('\n');
        };
        mindMapSection = `\n## 🗺️ 思维导图\n\n${renderTree(JSON.parse(mindMapRaw))}\n`;
      } catch { /* ignore */ }
    }

    // ── Annotations — split AI vs manual ───────────────────────
    const manualAnns = annotations.filter(a => !a.isAI);
    const aiAnns = annotations.filter(a => a.isAI && !a.text.startsWith('【全书核心】'));

    const renderAnn = (a: Annotation) => {
      const page = a.page ? `第 ${a.page} 页` : '';
      const type = typeLabel(a.color);
      return `> ${a.text}\n\n**${type}**${page ? `  ·  ${page}` : ''}\n${a.note ? `\n${a.note}` : ''}`;
    };

    const manualSection = manualAnns.length > 0
      ? `## ✍️ 我的标注（${manualAnns.length} 条）\n\n` +
        manualAnns.map(renderAnn).join('\n\n---\n\n')
      : '';

    const aiSection = aiAnns.length > 0
      ? `## 🤖 AI 智能标注（${aiAnns.length} 条）\n\n` +
        aiAnns.map(renderAnn).join('\n\n---\n\n')
      : '';

    // ── Related links (Obsidian wikilinks) ─────────────────────
    const relatedSection = `## 🔗 相关笔记

[[读书笔记]] · [[${title}]]`;

    const md = [
      frontmatter,
      `\n# 《${title}》`,
      `\n_导出时间：${dateTimeStr}_\n`,
      summarySection,
      mindMapSection,
      manualSection,
      aiSection ? `\n${aiSection}` : '',
      `\n${relatedSection}`,
    ].filter(Boolean).join('\n');

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSend = async (ann: Annotation) => {
    const question = (inputs[ann.id] || '').trim();
    if (!question || loading[ann.id]) return;

    const userMsg: MiniMessage = { role: 'user', content: question };
    setChats(prev => ({ ...prev, [ann.id]: [...(prev[ann.id] || []), userMsg] }));
    setInputs(prev => ({ ...prev, [ann.id]: '' }));
    setLoading(prev => ({ ...prev, [ann.id]: true }));

    try {
      const history = chats[ann.id] || [];
      const answer = await askAboutPassage(ann.text, bookContent, question, history);
      const aiMsg: MiniMessage = { role: 'assistant', content: answer };
      setChats(prev => ({ ...prev, [ann.id]: [...(prev[ann.id] || []), userMsg, aiMsg] }));
    } catch (err) {
      const errMsg: MiniMessage = {
        role: 'assistant',
        content: `错误: ${err instanceof Error ? err.message : '请求失败'}`,
      };
      setChats(prev => ({ ...prev, [ann.id]: [...(prev[ann.id] || []), errMsg] }));
    } finally {
      setLoading(prev => ({ ...prev, [ann.id]: false }));
    }
  };

  const typeLabel = (color: string) =>
    TYPE_CONFIG[color] ?? { label: '标注', bg: 'bg-slate-500/10', text: 'text-slate-400' };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--reader-panel-bg, #0f172a)', color: 'var(--reader-header-text, #e2e8f0)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--reader-panel-border, rgba(255,255,255,0.07))', background: 'var(--reader-panel-bg, #111827)' }}>
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--reader-header-text, #f1f5f9)' }}>
          标注
          <span className="ml-1.5 text-[13px] text-slate-500 font-normal">({annotations.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          {/* Collapse all / expand all */}
          {annotations.length > 0 && (
            <button
              onClick={() => {
                const allCollapsed = annotations.every(a => collapsed[a.id]);
                const next: Record<string, boolean> = {};
                annotations.forEach(a => { next[a.id] = !allCollapsed; });
                setCollapsed(next);
              }}
              className="text-[13px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded-lg hover:bg-slate-700/50 transition-colors"
            >
              {annotations.every(a => collapsed[a.id]) ? '全部展开' : '全部折叠'}
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={annotations.length === 0}
            title="导出为 Obsidian 笔记"
            className="flex items-center gap-1.5 text-[13px] disabled:opacity-30 transition-colors px-2 py-1 rounded-lg hover:bg-purple-500/10"
            style={{ color: '#a78bfa' }}
          >
            {/* Obsidian diamond icon */}
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L4 7.5V16.5L12 22L20 16.5V7.5L12 2ZM12 4.5L17.5 8L12 11.5L6.5 8L12 4.5ZM6 9.5L11 12.5V18.5L6 15.5V9.5ZM13 18.5V12.5L18 9.5V15.5L13 18.5Z"/>
            </svg>
            导出到 Obsidian
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {annotations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-5">
            <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3 border" style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.2)' }}>
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            {analysisStatus && analysisStatus.status !== 'done' ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-indigo-400 font-medium">AI 正在分析中…</p>
                </div>
                <p className="text-xs" style={{ color: 'var(--reader-header-sub, #94a3b8)' }}>{analysisStatus.message}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--reader-header-text, #e2e8f0)' }}>暂无标注</p>
                <p className="text-xs mb-4" style={{ color: 'var(--reader-header-sub, #94a3b8)' }}>选中文本即可高亮 · 或让 AI 自动分析全书</p>
                {onAnalyze && (
                  <button
                    onClick={onAnalyze}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:opacity-90 active:scale-95"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    AI 分析全书
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="p-3 space-y-2.5">
            <p className="text-[13px] text-slate-600 mb-3">按页码排序 · 点击引用区域跳转原文</p>

            {annotations.map(ann => {
              const { label, bg, text } = typeLabel(ann.color);
              const isCollapsed = collapsed[ann.id] ?? false;
              const isChatOpen = openChat === ann.id;
              const msgs = chats[ann.id] || [];

              return (
                <div
                  key={ann.id}
                  className="bg-slate-800/60 border border-slate-700/30 rounded-xl overflow-hidden"
                  style={{ borderTop: `3px solid ${ann.color}` }}
                >
                  {/* ── Quote row (always visible) ─────────────────── */}
                  <div
                    className="relative px-4 pt-3.5 pb-3 cursor-pointer group/quote"
                    style={{ background: `${ann.color}18` }}
                    onClick={() => ann.page && onJumpToAnnotation?.(ann.page, ann.text)}
                  >
                    <p
                      className="text-[14px] italic leading-relaxed text-slate-200 pr-7 group-hover/quote:text-white transition-colors"
                      style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                    >
                      "{ann.text}"
                    </p>

                    {/* Collapse / expand toggle — top right of quote */}
                    <button
                      className="absolute top-2.5 right-2.5 w-5 h-5 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-700/60 transition-all text-[14px] font-bold leading-none"
                      title={isCollapsed ? '展开' : '折叠'}
                      onClick={e => {
                        e.stopPropagation();
                        setCollapsed(prev => ({ ...prev, [ann.id]: !isCollapsed }));
                        // Also close chat when collapsing
                        if (!isCollapsed) setOpenChat(prev => prev === ann.id ? null : prev);
                      }}
                    >
                      {isCollapsed ? (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                        </svg>
                      )}
                    </button>
                  </div>

                  {/* ── Collapsible body ───────────────────────────── */}
                  {!isCollapsed && (
                    <>
                      {/* Thin divider */}
                      <div className="border-t border-slate-700/40" />

                      {/* Note text */}
                      <div className="px-4 pt-3 pb-2">
                        <p className="text-[14px] text-slate-300 leading-relaxed">{ann.note}</p>
                      </div>

                      {/* Ask AI button */}
                      <div className="px-4 pb-2" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setOpenChat(isChatOpen ? null : ann.id)}
                          className={`flex items-center gap-1.5 text-[13px] px-2.5 py-1.5 rounded-lg transition-all ${
                            isChatOpen
                              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                              : 'bg-slate-700/50 text-slate-500 hover:text-indigo-300 hover:bg-indigo-600/10 border border-slate-700/50'
                          }`}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                          </svg>
                          {isChatOpen ? '收起对话' : '针对此处问 AI'}
                          {msgs.length > 0 && (
                            <span className="ml-0.5 text-indigo-400 font-mono">({Math.ceil(msgs.length / 2)})</span>
                          )}
                        </button>
                      </div>

                      {/* Inline chat */}
                      {isChatOpen && (
                        <div className="border-t border-slate-700/40 bg-slate-900/40" onClick={e => e.stopPropagation()}>
                          {msgs.length > 0 && (
                            <div className="px-3 pt-2 pb-1 space-y-2 max-h-48 overflow-y-auto">
                              {msgs.map((m, i) => (
                                <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                                  <div className={`inline-block text-[14px] px-2.5 py-1.5 rounded-xl max-w-[90%] text-left leading-relaxed ${
                                    m.role === 'user'
                                      ? 'bg-indigo-600/20 text-indigo-200'
                                      : 'bg-slate-700/50 text-slate-300'
                                  }`}>
                                    {m.content}
                                  </div>
                                </div>
                              ))}
                              {loading[ann.id] && (
                                <div className="flex items-center gap-1.5 text-[13px] text-slate-500 pl-1 py-1">
                                  <div className="w-3 h-3 border border-slate-500 border-t-transparent rounded-full animate-spin" />
                                  AI 思考中…
                                </div>
                              )}
                            </div>
                          )}
                          {/* Quote bar showing the annotation's highlighted text */}
                          <div className="flex items-start gap-2 px-2.5 pt-2 pb-0">
                            <div className="w-0.5 self-stretch bg-indigo-500/50 rounded-full shrink-0 mt-0.5" />
                            <p className="flex-1 text-[12px] text-slate-500 italic leading-relaxed line-clamp-2">
                              {ann.text.length > 80 ? ann.text.slice(0, 80) + '…' : ann.text}
                            </p>
                          </div>
                          <div className="flex gap-1.5 p-2">
                            <input
                              type="text"
                              value={inputs[ann.id] || ''}
                              onChange={e => setInputs(prev => ({ ...prev, [ann.id]: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend(ann)}
                              placeholder="针对此段提问…"
                              disabled={loading[ann.id]}
                              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[14px] text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50 transition-colors"
                            />
                            <button
                              onClick={() => handleSend(ann)}
                              disabled={loading[ann.id] || !inputs[ann.id]?.trim()}
                              className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[13px] disabled:opacity-40 transition-colors"
                            >
                              发
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* ── Footer (always visible) ───────────────────── */}
                  <div
                    className="flex items-center justify-between px-4 py-2.5 border-t border-slate-700/30"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-2">
                      {ann.page && (
                        <span className="text-[13px] font-mono font-bold px-2 py-0.5 bg-slate-700/80 text-slate-300 rounded-md">
                          p.{ann.page}
                        </span>
                      )}
                      <span className={`text-[13px] px-1.5 py-0.5 rounded-md font-medium ${bg} ${text}`}>
                        {label}
                      </span>
                      {ann.isAI && <span className="text-[12px] text-slate-600">AI</span>}
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm('删除这条标注？')) handleDelete(ann.id);
                      }}
                      title="删除标注"
                      className="w-6 h-6 flex items-center justify-center text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
