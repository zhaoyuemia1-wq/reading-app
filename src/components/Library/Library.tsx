import { useState, useRef, useCallback, useEffect } from 'react';
import { useBooks } from '../../contexts/BookContext';
import { useTheme } from '../../contexts/ThemeContext';
import type { Language } from '../../contexts/ThemeContext';
import { t } from '../../i18n/translations';
import BookCard from './BookCard';
import BookSearch from './BookSearch';
import Settings from './Settings';
import NotesDashboard from '../Notes/NotesDashboard';
import KnowledgeBase from './KnowledgeBase';
import Journal from '../Journal/Journal';
import YouTubeView from '../YouTube/YouTubeView';
import * as db from '../../services/db';
import { detectFormat, generateId, readFileAsArrayBuffer, extractTitleFromFilename, generatePdfCover } from '../../services/fileParser';
import { analyzeBook } from '../../services/bookAnalysis';
import { autoClassifyBook } from '../../services/ai';
import type { Book } from '../../types';

interface Props {
  onOpenBook: (book: Book) => void | Promise<void>;
}

const FORMAT_CHIPS = ['PDF', 'EPUB', 'TXT', 'Markdown'];
const CATEGORIES = ['心理', '金融', '历史', '其他'];
const ALL_KEY = '全部';
const KB_KEY = '__knowledge__';
const JOURNAL_KEY = '__journal__';
const YOUTUBE_KEY = '__youtube__';

export default function Library({ onOpenBook }: Props) {
  const { state, dispatch } = useBooks();
  const { language } = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [analyzingBooks, setAnalyzingBooks] = useState<Record<string, string>>({});
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_KEY);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const categoryFileInputRef = useRef<HTMLInputElement>(null);

  // Auto-generate covers
  useEffect(() => {
    if (state.loading || state.books.length === 0) return;
    const booksWithoutCover = state.books.filter(b => b.format === 'pdf' && !b.coverImage);
    if (booksWithoutCover.length === 0) return;
    (async () => {
      for (const book of booksWithoutCover) {
        try {
          const coverImage = await generatePdfCover(book.fileData);
          if (!coverImage) continue;
          await db.updateBookCoverImage(book.id, coverImage);
          dispatch({ type: 'UPDATE_BOOK', payload: { ...book, coverImage } });
        } catch(e) { console.error('[cover] error', e); }
      }
    })();
  }, [state.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (id: string) => {
    await db.deleteBook(id);
    dispatch({ type: 'REMOVE_BOOK', payload: id });
  };

  const handleFiles = useCallback(async (files: FileList | null, category?: string) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const format = detectFormat(file);
        const fileData = await readFileAsArrayBuffer(file);
        const coverImage = format === 'pdf' ? await generatePdfCover(fileData) : undefined;

        let resolvedCategory = category;
        if (!resolvedCategory && localStorage.getItem('claude-api-key')) {
          const title = extractTitleFromFilename(file.name);
          let contentPreview = '';
          if (format === 'txt' || format === 'md') {
            contentPreview = new TextDecoder().decode(fileData.slice(0, 3000));
          }
          resolvedCategory = await autoClassifyBook(title, contentPreview, CATEGORIES);
        }

        const book: Book = {
          id: generateId(),
          title: extractTitleFromFilename(file.name),
          format,
          fileData,
          fileSize: file.size,
          addedAt: Date.now(),
          lastReadAt: Date.now(),
          progress: 0,
          coverImage,
          category: resolvedCategory,
        };
        await db.saveBook(book);
        dispatch({ type: 'ADD_BOOK', payload: book });
        const apiKey = localStorage.getItem('claude-api-key');
        if (apiKey) {
          setAnalyzingBooks(prev => ({ ...prev, [book.id]: '正在分析…' }));
          analyzeBook(book, (progress) => {
            if (progress.status === 'done' || progress.status === 'error') {
              setAnalyzingBooks(prev => { const next = { ...prev }; delete next[book.id]; return next; });
            } else {
              setAnalyzingBooks(prev => ({ ...prev, [book.id]: progress.message }));
            }
          });
        }
      } catch (e) { console.error(e); }
    }
  }, [dispatch]);

  const handleChangeCategory = useCallback(async (book: Book, category: string) => {
    const updated = { ...book, category };
    await db.saveBook(updated);
    dispatch({ type: 'UPDATE_BOOK', payload: updated });
  }, [dispatch]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const sortedBooks = [...state.books].sort((a, b) => b.lastReadAt - a.lastReadAt);
  const booksByCategory = (cat: string) =>
    cat === ALL_KEY ? sortedBooks : sortedBooks.filter(b => (b.category ?? '其他') === cat);
  const displayedBooks = booksByCategory(selectedCategory);

  if (showNotes) return <NotesDashboard onClose={() => setShowNotes(false)} />;

  return (
    <div
      style={{ display: 'flex', minHeight: '100vh' }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Hidden inputs */}
      <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.epub,.txt,.md" multiple
        onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
      <input ref={categoryFileInputRef} type="file" className="hidden" accept=".pdf,.epub,.txt,.md" multiple
        onChange={e => { handleFiles(e.target.files, pendingCategory ?? undefined); e.target.value = ''; setPendingCategory(null); }} />

      {/* ── Left Sidebar ──────────────────────────────────────── */}
      <aside style={{
        width: 230,
        background: '#0d1520',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        zIndex: 20,
        overflowY: 'auto',
      }}>
        {/* Logo */}
        <div style={{ padding: '22px 20px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Custom ReadMate logo mark */}
            <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <defs>
                <linearGradient id="rm-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#6366f1"/>
                  <stop offset="100%" stopColor="#a855f7"/>
                </linearGradient>
                <linearGradient id="rm-page-l" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="1"/>
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0.75"/>
                </linearGradient>
                <linearGradient id="rm-page-r" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55"/>
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0.25"/>
                </linearGradient>
              </defs>
              {/* Background rounded square */}
              <rect width="34" height="34" rx="9" fill="url(#rm-grad)"/>
              {/* Left page of open book */}
              <path d="M17 9.5 L8 13 L8 25 L17 22.5 Z" fill="url(#rm-page-l)"/>
              {/* Right page of open book */}
              <path d="M17 9.5 L26 13 L26 25 L17 22.5 Z" fill="url(#rm-page-r)"/>
              {/* Center spine highlight */}
              <line x1="17" y1="9.5" x2="17" y2="22.5" stroke="white" strokeWidth="1" strokeOpacity="0.6"/>
              {/* Small spark dot above — the "aha!" moment */}
              <circle cx="17" cy="6.5" r="1.5" fill="white" fillOpacity="0.9"/>
            </svg>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.01em' }}>
              ReadMate
            </span>
          </div>
        </div>

        {/* Search toggle */}
        <div style={{ padding: '0 12px 14px' }}>
          <button
            onClick={() => setShowSearch(v => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '7px 12px', cursor: 'pointer', color: '#94a3b8',
              fontSize: 13,
            }}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            搜索书籍…
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '0 8px' }}>
          {/* 全部 */}
          <SideNavItem
            label="全部书籍"
            count={sortedBooks.length}
            active={selectedCategory === ALL_KEY}
            onClick={() => setSelectedCategory(ALL_KEY)}
          />

          {/* Knowledge base */}
          <SideNavItem
            label="知识库"
            count={0}
            active={selectedCategory === KB_KEY}
            onClick={() => setSelectedCategory(KB_KEY)}
            showCount={false}
          />

          {/* Journal */}
          <SideNavItem
            label="日记"
            count={0}
            active={selectedCategory === JOURNAL_KEY}
            onClick={() => setSelectedCategory(JOURNAL_KEY)}
            showCount={false}
          />

          {/* YouTube */}
          <SideNavItem
            label="视频总结"
            count={0}
            active={selectedCategory === YOUTUBE_KEY}
            onClick={() => setSelectedCategory(YOUTUBE_KEY)}
            showCount={false}
          />

          {/* Divider */}
          <div style={{ margin: '10px 8px 6px', fontSize: 10, fontWeight: 600, color: '#334155', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            分类
          </div>

          {CATEGORIES.map(cat => (
            <SideNavItem
              key={cat}
              label={cat}
              count={booksByCategory(cat).length}
              active={selectedCategory === cat}
              onClick={() => setSelectedCategory(cat)}
              onAdd={() => { setPendingCategory(cat); setTimeout(() => categoryFileInputRef.current?.click(), 0); }}
            />
          ))}
        </nav>

        {/* Bottom actions */}
        <div style={{ padding: '12px 8px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SidebarBtn
            icon={<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>}
            label="上传书籍"
            onClick={() => fileInputRef.current?.click()}
            accent
          />
          <SidebarBtn
            icon={<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
            label={t(language, 'notes')}
            onClick={() => setShowNotes(true)}
          />
          <SidebarBtn
            icon={<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
            label={t(language, 'settings')}
            onClick={() => setShowSettings(true)}
          />
        </div>
      </aside>

      {/* ── Main Content ───────────────────────────────────────── */}
      <main style={{
        marginLeft: 230,
        flex: 1,
        minHeight: '100vh',
        padding: '44px 60px 80px',
        background: '#f5f3ef',
        color: '#1a1a1a',
      }}>
        {/* Search panel */}
        {showSearch && (
          <div style={{ marginBottom: 32 }}>
            <BookSearch />
          </div>
        )}

        {/* Loading */}
        {state.loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 120, gap: 12 }}>
            <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
            <span style={{ color: '#6b7280', fontSize: 14 }}>{t(language, 'loadingShelf')}</span>
          </div>
        ) : (
          /* ── Book shelf ── */
          <div>
            {/* Always-visible hero + upload zone */}
            {selectedCategory !== JOURNAL_KEY && selectedCategory !== KB_KEY && selectedCategory !== YOUTUBE_KEY && (
              <div style={{ marginBottom: 48 }}>
                <h1 style={{
                  fontSize: 'clamp(2.2rem,5vw,3.4rem)', fontWeight: 700, color: '#1a1a1a',
                  fontFamily: '"Georgia","Times New Roman",serif', letterSpacing: '-0.02em',
                  marginBottom: 12, lineHeight: 1.1, textAlign: 'center',
                }}>
                  {t(language, 'heroTitleBooks')}
                </h1>
                <p style={{ color: '#6b7280', fontSize: 15, lineHeight: 1.7, textAlign: 'center', marginBottom: 28 }}>
                  {t(language, 'heroSubtitle')}
                </p>
                <UploadZone isDragging={isDragging} language={language} onClick={() => fileInputRef.current?.click()} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}>
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>{t(language, 'supports')}</span>
                  {FORMAT_CHIPS.map(fmt => (
                    <span key={fmt} style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', padding: '2px 10px', borderRadius: 20, border: '1px solid #e5e7eb' }}>{fmt}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Journal view */}
            {selectedCategory === YOUTUBE_KEY ? (
              <YouTubeView />
            ) : selectedCategory === JOURNAL_KEY ? (
              <Journal />
            ) : selectedCategory === KB_KEY ? (
              <>
                <div style={{ marginBottom: 32, borderBottom: '2px solid #1a1a1a', paddingBottom: 16 }}>
                  <h2 style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a', fontFamily: '"Georgia","Times New Roman",serif', letterSpacing: '-0.02em' }}>
                    知识库
                  </h2>
                  <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 6 }}>所有书籍的 AI 分析、标注与核心概念汇总</p>
                </div>
                <KnowledgeBase onOpenBook={onOpenBook} />
              </>
            ) : (<>

          {/* Category header */}
            {sortedBooks.length > 0 && (
            <div style={{ marginBottom: 32, borderBottom: '2px solid #1a1a1a', paddingBottom: 16, display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <h2 style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a', fontFamily: '"Georgia","Times New Roman",serif', letterSpacing: '-0.02em' }}>
                {selectedCategory === ALL_KEY ? '全部书籍' : selectedCategory}
              </h2>
              <span style={{ fontSize: 13, color: '#9ca3af' }}>
                {displayedBooks.length} 本
              </span>
            </div>
            )}

            {/* Books grid */}
            {displayedBooks.length === 0 ? (
              <div style={{ textAlign: 'center', paddingTop: 80 }}>
                <p style={{ color: '#6b7280', fontSize: 15 }}>这个分类还没有书</p>
                <button
                  onClick={() => { setPendingCategory(selectedCategory); setTimeout(() => categoryFileInputRef.current?.click(), 0); }}
                  style={{ marginTop: 20, padding: '8px 20px', borderRadius: 10, background: '#f97316', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
                >
                  + 添加书籍
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
                {displayedBooks.map(book => (
                  <div key={book.id} style={{ position: 'relative' }} className="group/card">
                    <BookCard
                      book={book}
                      onOpen={onOpenBook}
                      onDelete={handleDelete}
                      analyzing={!!analyzingBooks[book.id]}
                    />
                    {/* Category dropdown on hover */}
                    <div className="absolute top-1 left-1 hidden group-hover/card:block z-10">
                      <select
                        value={book.category ?? '其他'}
                        onChange={e => handleChangeCategory(book, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        style={{ fontSize: 10, borderRadius: 4, padding: '2px 4px', border: 0, cursor: 'pointer', background: 'rgba(0,0,0,0.72)', color: '#e2e8f0' }}
                      >
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                ))}

                {/* Add book tile */}
                {selectedCategory !== ALL_KEY && (
                  <div
                    onClick={() => { setPendingCategory(selectedCategory); setTimeout(() => categoryFileInputRef.current?.click(), 0); }}
                    style={{ width: 128, height: 192, cursor: 'pointer', flexShrink: 0 }}
                  >
                    <div
                      style={{ width: '100%', height: '100%', borderRadius: 12, border: '1.5px dashed #d1d5db', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'border-color 0.2s', background: '#fafaf9' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = '#f97316')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = '#d1d5db')}
                    >
                      <svg width="20" height="20" fill="none" stroke="#9ca3af" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                      </svg>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>添加书籍</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>)}
          </div>
        )}
      </main>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/* ── Sidebar nav item ─────────────────────────────────── */
function SideNavItem({
  label, count, active, onClick, onAdd, showCount = true,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onAdd?: () => void;
  showCount?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
          background: active ? 'rgba(99,102,241,0.18)' : hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
          transition: 'background 0.15s',
          marginBottom: 1,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#a5b4fc' : '#94a3b8' }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {showCount && count > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: '#fff',
              background: active ? '#6366f1' : '#f97316',
              borderRadius: 10, padding: '1px 7px', minWidth: 20, textAlign: 'center',
            }}>
              {count}
            </span>
          )}
          {onAdd && hovered && (
            <button
              onClick={e => { e.stopPropagation(); onAdd(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', color: '#64748b', fontSize: 16, lineHeight: 1, borderRadius: 4 }}
              title="添加书籍"
            >
              +
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sidebar bottom button ────────────────────────────── */
function SidebarBtn({ icon, label, onClick, accent }: { icon: React.ReactNode; label: string; onClick: () => void; accent?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 9,
        padding: '7px 12px', borderRadius: 8, cursor: 'pointer', border: 'none',
        background: accent && hovered ? 'rgba(99,102,241,0.2)' : hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
        color: accent ? '#818cf8' : '#64748b',
        fontSize: 13, fontWeight: accent ? 500 : 400,
        transition: 'background 0.15s',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/* ── Upload zone (empty state) ────────────────────────── */
function UploadZone({ isDragging, language, onClick }: { isDragging: boolean; language: Language; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1.5px dashed ${isDragging || hovered ? '#f97316' : '#d1d5db'}`,
        borderRadius: 14,
        padding: '24px 28px',
        cursor: 'pointer',
        background: isDragging ? 'rgba(249,115,22,0.04)' : '#fafaf9',
        transition: 'border-color 0.2s, background 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(249,115,22,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" fill="none" stroke="#f97316" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a' }}>{t(language, 'dropOrClick')}</p>
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 3 }}>{t(language, 'dragHere')}</p>
        </div>
        <div style={{ padding: '8px 18px', borderRadius: 10, background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
          {t(language, 'browse')}
        </div>
      </div>
    </div>
  );
}
