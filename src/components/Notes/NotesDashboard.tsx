import { useState, useEffect, useMemo } from 'react';
import type { Note } from '../../types';
import * as db from '../../services/db';

interface Props {
  onClose: () => void;
}

export default function NotesDashboard({ onClose }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookFilter, setBookFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  useEffect(() => {
    db.getNotes().then(all => {
      const sorted = [...all].sort((a, b) => b.createdAt - a.createdAt);
      setNotes(sorted);
      setLoading(false);
    });
  }, []);

  const bookTitles = useMemo(() => {
    const titles = Array.from(new Set(notes.map(n => n.bookTitle)));
    return titles.sort();
  }, [notes]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    notes.forEach(n => n.tags.forEach(t => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [notes]);

  const filtered = useMemo(() => {
    return notes.filter(n => {
      if (bookFilter && n.bookTitle !== bookFilter) return false;
      if (tagFilter.trim() && !n.tags.some(t => t.toLowerCase().includes(tagFilter.toLowerCase()))) return false;
      return true;
    });
  }, [notes, bookFilter, tagFilter]);

  const handleDelete = async (id: string) => {
    await db.deleteNote(id);
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  const handleExport = () => {
    const lines: string[] = ['# 我的阅读笔记\n', `导出时间：${new Date().toLocaleString('zh-CN')}\n`];

    filtered.forEach(note => {
      lines.push(`---\n`);
      lines.push(`**书籍：** ${note.bookTitle}`);
      if (note.page) lines.push(`　**页码：** 第 ${note.page} 页`);
      lines.push(`　**时间：** ${new Date(note.createdAt).toLocaleString('zh-CN')}`);
      if (note.tags.length > 0) lines.push(`　**标签：** ${note.tags.map(t => `#${t}`).join(' ')}`);
      lines.push(`\n> ${note.highlightText.replace(/\n/g, '\n> ')}`);
      lines.push(`\n${note.text}\n`);
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reading-notes-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-800/80 px-6 py-4 sticky top-0 bg-slate-900/95 backdrop-blur-sm z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="group flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors"
            >
              <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              返回
            </button>
            <div className="w-px h-4 bg-slate-700" />
            <div>
              <h1 className="text-base font-semibold text-white">我的笔记</h1>
              <p className="text-slate-500 text-xs">
                {loading ? '加载中...' : `${filtered.length} 条笔记${notes.length !== filtered.length ? `（共 ${notes.length} 条）` : ''}`}
              </p>
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            导出 Markdown
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {/* Stats row */}
        {!loading && notes.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard label="全部笔记" value={notes.length} color="indigo" />
            <StatCard label="涵盖书籍" value={bookTitles.length} color="teal" />
            <StatCard label="使用标签" value={allTags.length} color="amber" />
          </div>
        )}

        {/* Filter bar */}
        {notes.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <select
              value={bookFilter}
              onChange={e => setBookFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer sm:w-56"
            >
              <option value="">全部书籍</option>
              {bookTitles.map(title => (
                <option key={title} value={title}>{title}</option>
              ))}
            </select>
            <div className="relative flex-1">
              <input
                type="text"
                value={tagFilter}
                onChange={e => setTagFilter(e.target.value)}
                placeholder="按标签筛选…"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 pl-8 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium">#</span>
            </div>
            {(bookFilter || tagFilter) && (
              <button
                onClick={() => { setBookFilter(''); setTagFilter(''); }}
                className="px-3 py-2 text-sm text-slate-500 hover:text-white hover:bg-slate-800 border border-slate-700 rounded-xl transition-all"
              >
                清除
              </button>
            )}
          </div>
        )}

        {/* Popular tags */}
        {allTags.length > 0 && !tagFilter && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {allTags.slice(0, 12).map(tag => (
              <button
                key={tag}
                onClick={() => setTagFilter(tag)}
                className="px-2.5 py-1 bg-slate-800 hover:bg-indigo-600/20 border border-slate-700 hover:border-indigo-500/40 text-slate-400 hover:text-indigo-300 text-xs rounded-full transition-all"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center py-24 gap-3">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-500 text-sm">加载笔记...</p>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-4 border border-slate-700">
              <svg className="w-8 h-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-slate-300 font-medium mb-1">暂无笔记</p>
            <p className="text-slate-500 text-sm">阅读时选中文字，点击「写笔记」即可记录想法</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-slate-400 font-medium mb-1">没有匹配的笔记</p>
            <p className="text-slate-600 text-sm">尝试调整筛选条件</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(note => (
              <NoteCard key={note.id} note={note} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: 'indigo' | 'teal' | 'amber' }) {
  const colorMap = {
    indigo: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    teal: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  };
  return (
    <div className={`rounded-xl p-3 border text-center ${colorMap[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs mt-0.5 opacity-80">{label}</div>
    </div>
  );
}

function NoteCard({ note, onDelete }: { note: Note; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="group bg-slate-800/60 border border-slate-700/40 hover:border-slate-600/60 rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-black/20">
      {/* Highlight excerpt */}
      <div className="bg-amber-500/6 border-b border-amber-500/10 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="w-0.5 h-full bg-amber-500/50 rounded-full shrink-0 self-stretch min-h-[1rem] mt-0.5" />
          <p className="text-sm text-amber-300/70 line-clamp-3 leading-relaxed italic flex-1">
            {note.highlightText}
          </p>
        </div>
      </div>

      {/* Note text */}
      <div className="px-4 py-3.5">
        <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
          {note.text}
        </p>
      </div>

      {/* Meta row */}
      <div className="px-4 pb-3.5 flex items-center justify-between flex-wrap gap-2 border-t border-slate-700/30 pt-3">
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <span className="flex items-center gap-1 text-slate-300 font-medium">
            <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            {note.bookTitle}
          </span>
          {note.page && (
            <span className="text-slate-500">第 {note.page} 页</span>
          )}
          <span className="text-slate-600">{new Date(note.createdAt).toLocaleDateString('zh-CN')}</span>
          {note.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {note.tags.map(tag => (
                <span
                  key={tag}
                  className="px-2 py-0.5 bg-indigo-600/15 text-indigo-400 border border-indigo-500/20 rounded-full text-xs"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">确认删除？</span>
              <button
                onClick={() => onDelete(note.id)}
                className="text-xs text-rose-400 hover:text-rose-300 font-medium transition-colors"
              >
                删除
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-xs text-slate-500 hover:text-white transition-colors"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-xs text-slate-700 hover:text-slate-400 transition-colors opacity-0 group-hover:opacity-100"
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
