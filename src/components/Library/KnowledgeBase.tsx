/**
 * KnowledgeBase.tsx
 * 知识库视图 — 汇总所有书的 AI 分析、标注、关键词，类似 Buffett Letters 网站风格
 */
import { useState, useEffect, useMemo } from 'react';
import { useBooks } from '../../contexts/BookContext';
import * as db from '../../services/db';
import type { Annotation, Book } from '../../types';

interface Props {
  onOpenBook: (book: Book) => void | Promise<void>;
}

interface BookSummary {
  book: Book;
  summary: string;
  keyInsight: string;
  annotations: Annotation[];
  concepts: string[];
}

const TYPE_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  '#fbbf24': { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24', label: '洞察' },
  '#60a5fa': { bg: 'rgba(96,165,250,0.12)', color: '#60a5fa', label: '行动' },
  '#a78bfa': { bg: 'rgba(167,139,250,0.12)', color: '#a78bfa', label: '概念' },
  '#6366f1': { bg: 'rgba(99,102,241,0.12)', color: '#818cf8', label: 'AI' },
  '#34d399': { bg: 'rgba(52,211,153,0.12)', color: '#34d399', label: '翻译' },
};

export default function KnowledgeBase({ onOpenBook }: Props) {
  const { state } = useBooks();
  const [summaries, setSummaries] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedConcept, setSelectedConcept] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const results: BookSummary[] = [];
      for (const book of state.books) {
        const anns = await db.getAnnotations(book.id);
        const aiSummaryAnn = anns.find(a => a.isAI && a.text.startsWith('【全书核心】'));
        const summary = aiSummaryAnn?.note?.replace(/^📖 全书总结：/, '') || '';
        const keyInsight = aiSummaryAnn?.text?.replace(/^【全书核心】/, '') || '';

        // Extract concept-like keywords from annotations
        const conceptSet = new Set<string>();
        anns.filter(a => a.isAI && a.color === '#a78bfa').forEach(a => {
          // Pull short phrases from note
          const words = a.note.replace(/[🌟💡📖]/g, '').split(/[，。、\s]+/).filter(w => w.length >= 2 && w.length <= 8);
          words.slice(0, 2).forEach(w => conceptSet.add(w));
        });

        results.push({
          book,
          summary,
          keyInsight,
          annotations: anns.filter(a => !a.text.startsWith('【全书核心】')),
          concepts: Array.from(conceptSet).slice(0, 6),
        });
      }
      setSummaries(results.filter(s => s.summary || s.annotations.length > 0));
      setLoading(false);
    })();
  }, [state.books]);

  // All unique concepts across books
  const allConcepts = useMemo(() => {
    const map = new Map<string, number>();
    summaries.forEach(s => s.concepts.forEach(c => map.set(c, (map.get(c) || 0) + 1)));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [summaries]);

  // High-priority annotations across all books
  const topAnnotations = useMemo(() => {
    const all: Array<{ ann: Annotation; bookTitle: string; bookId: string }> = [];
    summaries.forEach(s => {
      s.annotations
        .filter(a => a.isAI && a.note.startsWith('🌟'))
        .forEach(a => all.push({ ann: a, bookTitle: s.book.title, bookId: s.book.id }));
    });
    return all.slice(0, 12);
  }, [summaries]);

  const filteredSummaries = useMemo(() => {
    let list = summaries;
    if (selectedBook) list = list.filter(s => s.book.id === selectedBook);
    if (selectedConcept) list = list.filter(s => s.concepts.includes(selectedConcept));
    return list;
  }, [summaries, selectedBook, selectedConcept]);

  const totalAnnotations = summaries.reduce((n, s) => n + s.annotations.length, 0);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 12 }}>
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <span style={{ color: '#64748b', fontSize: 14 }}>正在构建知识库…</span>
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <p style={{ color: '#64748b', fontSize: 15 }}>还没有 AI 分析的书籍</p>
        <p style={{ color: '#475569', fontSize: 13, marginTop: 8 }}>打开一本书，AI 会自动分析并生成知识库</p>
      </div>
    );
  }

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 36, flexWrap: 'wrap' }}>
        {[
          { label: '书籍', value: state.books.length },
          { label: '已分析', value: summaries.length },
          { label: '智能标注', value: totalAnnotations },
          { label: '核心概念', value: allConcepts.length },
        ].map(stat => (
          <div key={stat.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '14px 24px', minWidth: 110 }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#f1f5f9', fontFamily: '"Georgia",serif' }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Concepts cloud */}
      {allConcepts.length > 0 && (
        <section style={{ marginBottom: 40 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>
            核心概念
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {allConcepts.map(([concept, count]) => (
              <button
                key={concept}
                onClick={() => setSelectedConcept(selectedConcept === concept ? null : concept)}
                style={{
                  padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
                  fontSize: 13, fontWeight: 500,
                  background: selectedConcept === concept ? '#f97316' : 'rgba(249,115,22,0.1)',
                  color: selectedConcept === concept ? '#fff' : '#f97316',
                  border: `1px solid ${selectedConcept === concept ? '#f97316' : 'rgba(249,115,22,0.25)'}`,
                  transition: 'all 0.15s',
                }}
              >
                {concept}
                <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8 }}>{count}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Top insights */}
      {topAnnotations.length > 0 && !selectedBook && !selectedConcept && (
        <section style={{ marginBottom: 44 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>
            🌟 重要洞见
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {topAnnotations.map(({ ann, bookTitle, bookId }, i) => (
              <div
                key={i}
                onClick={() => setSelectedBook(bookId)}
                style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                  borderLeft: `3px solid ${ann.color}`,
                  borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
              >
                <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 10, fontStyle: 'italic', fontFamily: '"Georgia",serif' }}>
                  "{ann.text.length > 100 ? ann.text.slice(0, 100) + '…' : ann.text}"
                </p>
                <p style={{ fontSize: 12, color: '#64748b' }}>
                  {ann.note.replace(/^[🌟💡]\s*/, '').slice(0, 60)}…
                </p>
                <p style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>《{bookTitle}》</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Book cards */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            书籍详情
          </h3>
          {(selectedBook || selectedConcept) && (
            <button
              onClick={() => { setSelectedBook(null); setSelectedConcept(null); }}
              style={{ fontSize: 12, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              ✕ 清除筛选
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filteredSummaries.map(({ book, summary, keyInsight, annotations }) => {
            const isExpanded = selectedBook === book.id;
            const aiAnns = annotations.filter(a => a.isAI);
            const myAnns = annotations.filter(a => !a.isAI);

            return (
              <div
                key={book.id}
                style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 14, overflow: 'hidden',
                }}
              >
                {/* Book header */}
                <div
                  onClick={() => setSelectedBook(isExpanded ? null : book.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 20px', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Cover thumbnail */}
                  {book.coverImage ? (
                    <img src={book.coverImage} alt={book.title} style={{ width: 44, height: 60, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 44, height: 60, borderRadius: 6, background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="20" height="20" fill="none" stroke="#6366f1" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <h4 style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', fontFamily: '"Georgia",serif' }}>
                        《{book.title}》
                      </h4>
                      <span style={{ fontSize: 11, color: '#475569', background: 'rgba(255,255,255,0.05)', padding: '1px 8px', borderRadius: 10 }}>
                        {aiAnns.length} 条标注
                      </span>
                      {myAnns.length > 0 && (
                        <span style={{ fontSize: 11, color: '#f97316', background: 'rgba(249,115,22,0.1)', padding: '1px 8px', borderRadius: 10 }}>
                          {myAnns.length} 条笔记
                        </span>
                      )}
                    </div>
                    {keyInsight && (
                      <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
                        {keyInsight.length > 80 ? keyInsight.slice(0, 80) + '…' : keyInsight}
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <button
                      onClick={e => { e.stopPropagation(); onOpenBook(book); }}
                      style={{ padding: '5px 14px', borderRadius: 8, background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)', cursor: 'pointer', fontSize: 12 }}
                    >
                      阅读
                    </button>
                    <svg
                      width="16" height="16" fill="none" stroke="#475569" viewBox="0 0 24 24"
                      style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '20px 20px 20px' }}>
                    {summary && (
                      <div style={{ marginBottom: 20 }}>
                        <p style={{ fontSize: 11, color: '#475569', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>全书总结</p>
                        <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.7 }}>{summary}</p>
                      </div>
                    )}

                    {/* Annotation type breakdown */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                      {Object.entries(TYPE_COLORS).map(([color, cfg]) => {
                        const cnt = annotations.filter(a => a.color === color && !a.text.startsWith('【全书核心】')).length;
                        if (cnt === 0) return null;
                        return (
                          <span key={color} style={{ fontSize: 12, padding: '3px 12px', borderRadius: 20, background: cfg.bg, color: cfg.color }}>
                            {cfg.label} · {cnt}
                          </span>
                        );
                      })}
                    </div>

                    {/* Top annotations for this book */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                      {annotations
                        .filter(a => !a.text.startsWith('【全书核心】'))
                        .slice(0, 6)
                        .map(ann => (
                          <div key={ann.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', borderLeft: `2px solid ${ann.color}` }}>
                            <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, fontStyle: 'italic', marginBottom: 6 }}>
                              "{ann.text.length > 70 ? ann.text.slice(0, 70) + '…' : ann.text}"
                            </p>
                            {ann.page && <span style={{ fontSize: 11, color: '#475569' }}>第 {ann.page} 页</span>}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
