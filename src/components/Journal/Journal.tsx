/**
 * Journal.tsx — 个人日记 & 读书笔记
 * 支持自由写作，可选关联书籍，按日期归组
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useBooks } from '../../contexts/BookContext';
import * as db from '../../services/db';
import { generateId } from '../../services/fileParser';
import type { JournalEntry } from '../../types';

interface Props {
  defaultBookId?: string;   // pre-link to a book (when opened from reader)
  defaultBookTitle?: string;
}

const MOODS = ['😊', '🤔', '😔', '🔥', '😴', '💡', '❤️', '😤'];

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}
function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
function dateKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function Journal({ defaultBookId }: Props) {
  const { state } = useBooks();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'write' | 'edit'>('list');
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [filterBookId, setFilterBookId] = useState<string>(defaultBookId || '');

  // Editor state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState('');
  const [linkedBookId, setLinkedBookId] = useState(defaultBookId || '');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    db.getJournalEntries().then(all => {
      setEntries(all.sort((a, b) => b.createdAt - a.createdAt));
      setLoading(false);
    });
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [content]);

  const filteredEntries = useMemo(() =>
    filterBookId ? entries.filter(e => e.bookId === filterBookId) : entries,
    [entries, filterBookId]
  );

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, JournalEntry[]>();
    for (const e of filteredEntries) {
      const k = dateKey(e.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries());
  }, [filteredEntries]);

  const linkedBook = state.books.find(b => b.id === linkedBookId);

  const openNew = () => {
    setTitle('');
    setContent('');
    setMood('');
    setLinkedBookId(defaultBookId || '');
    setTags('');
    setEditingEntry(null);
    setView('write');
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const openEdit = (entry: JournalEntry) => {
    setTitle(entry.title);
    setContent(entry.content);
    setMood(entry.mood || '');
    setLinkedBookId(entry.bookId || '');
    setTags(entry.tags.join(' '));
    setEditingEntry(entry);
    setView('edit');
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    const now = Date.now();
    const parsedTags = tags.split(/[\s,#]+/).filter(Boolean);
    const book = state.books.find(b => b.id === linkedBookId);

    const entry: JournalEntry = {
      id: editingEntry?.id || generateId(),
      title: title.trim() || new Date(now).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) + '的日记',
      content: content.trim(),
      mood: mood || undefined,
      bookId: linkedBookId || undefined,
      bookTitle: book?.title,
      tags: parsedTags,
      createdAt: editingEntry?.createdAt || now,
      updatedAt: now,
    };

    await db.saveJournalEntry(entry);
    setEntries(prev => {
      const without = prev.filter(e => e.id !== entry.id);
      return [entry, ...without].sort((a, b) => b.createdAt - a.createdAt);
    });
    setSaving(false);
    setView('list');
  };

  const handleDelete = async (id: string) => {
    await db.deleteJournalEntry(id);
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const handleExport = () => {
    const lines = ['# 我的读书日记\n', `导出时间：${new Date().toLocaleString('zh-CN')}\n`];
    for (const [, dayEntries] of grouped) {
      lines.push(`\n## ${formatDate(dayEntries[0].createdAt)}\n`);
      for (const e of dayEntries) {
        lines.push(`### ${e.mood ? e.mood + ' ' : ''}${e.title}`);
        if (e.bookTitle) lines.push(`> 📖 《${e.bookTitle}》`);
        lines.push('');
        lines.push(e.content);
        if (e.tags.length) lines.push(`\n标签：${e.tags.map(t => '#' + t).join(' ')}`);
        lines.push('\n---\n');
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '我的读书日记.md'; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Editor view ────────────────────────────────────────────
  if (view === 'write' || view === 'edit') {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {/* Editor header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <button
            onClick={() => setView('list')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 14, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回
          </button>
          <button
            onClick={handleSave}
            disabled={!content.trim() || saving}
            style={{ padding: '8px 22px', borderRadius: 10, background: content.trim() ? '#f97316' : '#e5e7eb', color: content.trim() ? '#fff' : '#9ca3af', border: 'none', cursor: content.trim() ? 'pointer' : 'default', fontSize: 14, fontWeight: 600, transition: 'background 0.15s' }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>

        {/* Mood picker */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {MOODS.map(m => (
            <button
              key={m}
              onClick={() => setMood(mood === m ? '' : m)}
              style={{ fontSize: 22, background: mood === m ? 'rgba(249,115,22,0.12)' : 'transparent', border: mood === m ? '2px solid #f97316' : '2px solid transparent', borderRadius: 10, padding: '4px 8px', cursor: 'pointer', transition: 'all 0.15s' }}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Title */}
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="标题（可选）"
          style={{ width: '100%', fontSize: 22, fontWeight: 700, color: '#1a1a1a', fontFamily: '"Georgia","Times New Roman",serif', border: 'none', borderBottom: '2px solid #e5e7eb', background: 'transparent', outline: 'none', paddingBottom: 10, marginBottom: 20, boxSizing: 'border-box' }}
        />

        {/* Content */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`今天读了什么？有什么感想？\n\n在这里自由记录…`}
          style={{ width: '100%', minHeight: 280, fontSize: 16, lineHeight: 1.9, color: '#374151', fontFamily: '"Georgia","Times New Roman",serif', border: 'none', background: 'transparent', outline: 'none', resize: 'none', boxSizing: 'border-box', overflow: 'hidden' }}
        />

        {/* Meta row */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Link to book */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" fill="none" stroke="#9ca3af" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <select
              value={linkedBookId}
              onChange={e => setLinkedBookId(e.target.value)}
              style={{ fontSize: 13, color: linkedBookId ? '#f97316' : '#9ca3af', border: 'none', background: 'transparent', cursor: 'pointer', outline: 'none', fontWeight: linkedBookId ? 500 : 400 }}
            >
              <option value="">关联书籍（可选）</option>
              {state.books.map(b => (
                <option key={b.id} value={b.id}>《{b.title}》</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <svg width="14" height="14" fill="none" stroke="#9ca3af" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <input
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="标签 如: 心理 成长"
              style={{ fontSize: 13, color: '#6b7280', border: 'none', background: 'transparent', outline: 'none', flex: 1 }}
            />
          </div>
        </div>

        {/* Book context pill */}
        {linkedBook && (
          <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)' }}>
            <span style={{ fontSize: 12, color: '#f97316' }}>📖 《{linkedBook.title}》</span>
          </div>
        )}
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, borderBottom: '2px solid #1a1a1a', paddingBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a', fontFamily: '"Georgia","Times New Roman",serif', letterSpacing: '-0.02em' }}>
            日记
          </h2>
          <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>
            {entries.length} 篇 · 记录你的阅读与思考
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {entries.length > 0 && (
            <button
              onClick={handleExport}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 13, cursor: 'pointer' }}
            >
              导出
            </button>
          )}
          <button
            onClick={openNew}
            style={{ padding: '8px 20px', borderRadius: 10, background: '#f97316', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            写日记
          </button>
        </div>
      </div>

      {/* Book filter */}
      {state.books.length > 0 && entries.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          <button
            onClick={() => setFilterBookId('')}
            style={{ padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid', borderColor: !filterBookId ? '#f97316' : '#e5e7eb', background: !filterBookId ? '#f97316' : '#fff', color: !filterBookId ? '#fff' : '#6b7280' }}
          >
            全部
          </button>
          {state.books.filter(b => entries.some(e => e.bookId === b.id)).map(b => (
            <button
              key={b.id}
              onClick={() => setFilterBookId(filterBookId === b.id ? '' : b.id)}
              style={{ padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid', borderColor: filterBookId === b.id ? '#f97316' : '#e5e7eb', background: filterBookId === b.id ? '#f97316' : '#fff', color: filterBookId === b.id ? '#fff' : '#6b7280', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              《{b.title}》
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {loading ? (
        <div style={{ textAlign: 'center', paddingTop: 80, color: '#9ca3af' }}>加载中…</div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 80 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📓</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginBottom: 8, fontFamily: '"Georgia",serif' }}>
            开始你的第一篇日记
          </p>
          <p style={{ fontSize: 14, color: '#9ca3af', marginBottom: 28 }}>
            记录阅读感想、每日思考，或者随手写下任何想法
          </p>
          <button
            onClick={openNew}
            style={{ padding: '10px 28px', borderRadius: 12, background: '#f97316', color: '#fff', border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            写第一篇日记
          </button>
        </div>
      ) : (
        /* Grouped entries */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
          {grouped.map(([key, dayEntries]) => (
            <div key={key}>
              {/* Date heading */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                  {formatDate(dayEntries[0].createdAt)}
                </span>
                <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
              </div>

              {/* Entries for this day */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {dayEntries.map(entry => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Single entry card ────────────────────────────────── */
function EntryCard({ entry, onEdit, onDelete }: {
  entry: JournalEntry;
  onEdit: (e: JournalEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const preview = entry.content.slice(0, 200);
  const needsTruncation = entry.content.length > 200;

  return (
    <div
      style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', padding: '20px 24px', transition: 'box-shadow 0.15s' }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
    >
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {entry.mood && <span style={{ fontSize: 20 }}>{entry.mood}</span>}
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', fontFamily: '"Georgia","Times New Roman",serif', margin: 0 }}>
              {entry.title}
            </h3>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>{formatTime(entry.createdAt)}</span>
          </div>
        </div>
        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {confirming ? (
            <>
              <button onClick={() => onDelete(entry.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>确认删除</button>
              <button onClick={() => setConfirming(false)} style={{ fontSize: 12, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>取消</button>
            </>
          ) : (
            <>
              <button onClick={() => onEdit(entry)} style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f4')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >编辑</button>
              <button onClick={() => setConfirming(true)} style={{ fontSize: 12, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, transition: 'all 0.1s' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fef2f2'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#d1d5db'; e.currentTarget.style.background = 'none'; }}
              >删除</button>
            </>
          )}
        </div>
      </div>

      {/* Book link */}
      {entry.bookTitle && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.18)', marginBottom: 12 }}>
          <svg width="11" height="11" fill="none" stroke="#f97316" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span style={{ fontSize: 12, color: '#f97316', fontWeight: 500 }}>《{entry.bookTitle}》</span>
        </div>
      )}

      {/* Content */}
      <p style={{ fontSize: 15, lineHeight: 1.8, color: '#374151', fontFamily: '"Georgia","Times New Roman",serif', margin: 0, whiteSpace: 'pre-wrap' }}>
        {expanded || !needsTruncation ? entry.content : preview + '…'}
      </p>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ marginTop: 8, fontSize: 13, color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
          {entry.tags.map(tag => (
            <span key={tag} style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: '#f5f5f4', color: '#6b7280' }}>
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
