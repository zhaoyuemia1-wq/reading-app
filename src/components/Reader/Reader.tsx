import { useState, useCallback, useEffect, useRef } from 'react';
import type { Book, Annotation, Note } from '../../types';
import { useBooks } from '../../contexts/BookContext';
import { useTheme } from '../../contexts/ThemeContext';
import { t } from '../../i18n/translations';
import * as db from '../../services/db';
import { generateId } from '../../services/fileParser';
import { smartAnnotate, generateSummary } from '../../services/ai';
import { analyzeBook, type AnalysisProgress } from '../../services/bookAnalysis';
import PdfReader from './PdfReader';
import EpubReader from './EpubReader';
import TextReader from './TextReader';
import TextSelection from './TextSelection';
import NoteEditor from './NoteEditor';
import AIPanel from '../AIPanel/AIPanel';
import AnnotationList from '../Annotations/AnnotationList';
import Settings from '../Library/Settings';

interface Props {
  book: Book;
  onBack: () => void;
}

export default function Reader({ book, onBack }: Props) {
  const { state, dispatch } = useBooks();
  const { language } = useTheme();
  const [currentPage, setCurrentPage] = useState(book.currentPage || 1);
  const [totalPages, setTotalPages] = useState(book.totalPages || 0);
  const [selectedText, setSelectedText] = useState('');
  const [selectionContext, setSelectionContext] = useState('');
  const [selectedSpans, setSelectedSpans] = useState<string[]>([]);
  const [bookContent, setBookContent] = useState('');
  const [showAI, setShowAI] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});
  const [annWidth, setAnnWidth] = useState(320);
  const [aiWidth, setAiWidth] = useState(320);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisProgress | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const draggingRef = useRef<{ panel: 'ann' | 'ai'; startX: number; startW: number } | null>(null);

  // Global mouse handlers for panel resizing
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      const delta = d.startX - e.clientX; // dragging left edge → move left = wider
      const newW = Math.min(600, Math.max(200, d.startW + delta));
      if (d.panel === 'ann') setAnnWidth(newW);
      else setAiWidth(newW);
    };
    const onUp = () => { draggingRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);
  // Injected message from TextSelection → forwarded to AIPanel chat
  const [externalAiMessage, setExternalAiMessage] = useState<{
    userContent: string;
    assistantContent: string;
    id: string;
  } | null>(null);
  // Quote explicitly sent to AI chat via "引用" button
  const [quotedText, setQuotedText] = useState<{ text: string; id: string } | null>(null);

  const handleAIResult = useCallback((userContent: string, assistantContent: string) => {
    setExternalAiMessage({ userContent, assistantContent, id: Date.now().toString() });
    setShowAI(true); // auto-open AI panel
  }, []);

  const handleQuote = useCallback((text: string) => {
    setQuotedText({ text, id: Date.now().toString() });
    setShowAI(true); // open AI panel
  }, []);

  // Load annotations from DB when book opens, then auto-analyze if none exist
  useEffect(() => {
    db.getAnnotations(book.id).then(dbAnns => {
      const existingIds = new Set(state.annotations.map(a => a.id));
      for (const ann of dbAnns) {
        if (!existingIds.has(ann.id)) {
          dispatch({ type: 'ADD_ANNOTATION', payload: ann });
        }
      }

      // Auto-analyze: always run if API key configured and analysis not done recently
      const apiKey = localStorage.getItem('claude-api-key');
      const lastAnalysis = localStorage.getItem(`last-analysis-${book.id}`);
      const oneHour = 60 * 60 * 1000;
      const needsAnalysis = !lastAnalysis || Date.now() - parseInt(lastAnalysis) > oneHour;
      if (apiKey && needsAnalysis) {
        runAnalysis();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const runAnalysis = useCallback(() => {
    const apiKey = localStorage.getItem('claude-api-key');
    if (!apiKey) {
      setShowSettings(true);
      return;
    }
    setAnalysisStatus({ status: 'extracting', message: '正在提取全书文字…' });
    analyzeBook(book, (progress) => {
      setAnalysisStatus(progress);
      if (progress.status === 'done' || progress.status === 'error') {
        if (progress.status === 'done') {
          localStorage.setItem(`last-analysis-${book.id}`, String(Date.now()));
        }
        db.getAnnotations(book.id).then(newAnns => {
          dispatch({ type: 'SET_ANNOTATIONS', payload: newAnns });
        });
        setTimeout(() => setAnalysisStatus(null), 5000);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // `sourcePage` is explicitly passed from PdfReader (currentPageRef.current) to avoid
  // stale-closure issues where Reader's currentPage state lags behind the visual page.
  const handleTextSelect = useCallback((text: string, context: string, _sourcePage?: number, spans?: string[]) => {
    setSelectedText(text);
    setSelectionContext(context);
    // Store spans for later use if user manually highlights
    setSelectedSpans(spans ?? []);
  }, []);

  const handleContentReady = useCallback((text: string) => {
    setBookContent(text);
  }, []);

  // For PDFs: derive bookContent from all extracted page texts
  useEffect(() => {
    if (book.format !== 'pdf') return;
    const pages = Object.keys(pageTexts);
    if (pages.length === 0) return;
    const combined = pages
      .map(Number)
      .sort((a, b) => a - b)
      .map(p => pageTexts[p])
      .join('\n\n');
    setBookContent(combined);
  }, [pageTexts, book.format]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    const progress = totalPages > 0 ? (page / totalPages) * 100 : 0;
    db.updateBookProgress(book.id, progress, page);
    dispatch({ type: 'UPDATE_PROGRESS', payload: { id: book.id, progress, currentPage: page } });
  }, [book.id, totalPages, dispatch]);

  const scrollToAnnotation = useCallback((page: number, text: string) => {
    handlePageChange(page);
    // Flash the matching mark after the page renders — NO scrollIntoView here
    // because a second scroll would fight with the page-detection logic.
    setTimeout(() => {
      const marks = document.querySelectorAll<HTMLElement>('.textLayer mark');
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      for (const mark of marks) {
        if (words.some(w => (mark.textContent?.toLowerCase() ?? '').includes(w))) {
          mark.style.outline = `3px solid ${mark.style.background || '#fbbf24'}`;
          mark.style.outlineOffset = '3px';
          mark.style.borderRadius = '2px';
          setTimeout(() => {
            mark.style.outline = '';
            mark.style.outlineOffset = '';
            mark.style.borderRadius = '';
          }, 2000);
          break;
        }
      }
    }, 600);
  }, [handlePageChange]);

  const handleManualAnnotate = async () => {
    const note = prompt('请输入你的笔记：');
    if (!note) return;
    const annotation: Annotation = {
      id: generateId(),
      bookId: book.id,
      text: selectedText,
      note,
      isAI: false,
      page: currentPage,
      color: '#fbbf24',
      createdAt: Date.now(),
    };
    await db.saveAnnotation(annotation);
    dispatch({ type: 'ADD_ANNOTATION', payload: annotation });
    setSelectedText('');
  };

  // Plain yellow highlight — no note prompt, just save and close popup
  const handleHighlight = useCallback(async () => {
    const annotation: Annotation = {
      id: generateId(),
      bookId: book.id,
      text: selectedText,
      note: '',
      isAI: false,
      page: currentPage,
      color: '#fbbf24',
      createdAt: Date.now(),
      spans: selectedSpans.length > 0 ? selectedSpans : undefined,
    };
    await db.saveAnnotation(annotation);
    dispatch({ type: 'ADD_ANNOTATION', payload: annotation });
    setSelectedText('');
    setSelectedSpans([]);
  }, [book.id, selectedText, selectedSpans, currentPage, dispatch]);

  // Right-click on a PDF highlight → delete that annotation
  const handleDeleteAnnotation = useCallback(async (id: string) => {
    await db.deleteAnnotation(id);
    dispatch({ type: 'REMOVE_ANNOTATION', payload: id });
  }, [dispatch]);

  const handleAIAnnotate = async () => {
    setAiLoading(true);
    try {
      const aiNote = await smartAnnotate(selectedText, bookContent.slice(0, 3000));
      const annotation: Annotation = {
        id: generateId(),
        bookId: book.id,
        text: selectedText,
        note: aiNote,
        isAI: true,
        page: currentPage,
        color: '#6366f1',
        createdAt: Date.now(),
      };
      await db.saveAnnotation(annotation);
      dispatch({ type: 'ADD_ANNOTATION', payload: annotation });
      setSelectedText('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'AI 标注失败');
    } finally {
      setAiLoading(false);
    }
  };

  const handleOpenNoteEditor = () => {
    setShowNoteEditor(true);
  };

  const handleSaveNote = async (text: string, tags: string[]) => {
    const note: Note = {
      id: generateId(),
      bookId: book.id,
      bookTitle: book.title,
      text,
      highlightText: selectedText,
      page: currentPage,
      tags,
      createdAt: Date.now(),
    };
    await db.saveNote(note);
    setShowNoteEditor(false);
    setSelectedText('');
  };

  const handleSummarize = async () => {
    setShowAI(true);
    setAiLoading(true);
    try {
      const result = await generateSummary(selectedText, selectionContext);
      alert(`摘要：\n${result.summary}\n\n要点：\n${result.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '生成摘要失败');
    } finally {
      setAiLoading(false);
      setSelectedText('');
    }
  };

  const progressPct = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--reader-bg)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 shrink-0 backdrop-blur-sm border-b" style={{ background: 'var(--reader-header-bg)', borderColor: 'var(--reader-header-border)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm transition-colors shrink-0 group"
            style={{ color: 'var(--reader-header-sub)' }}
          >
            <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t(language, 'back')}
          </button>
          <div className="w-px h-4" style={{ background: 'var(--reader-header-border)' }} />
          <h1 className="text-sm font-medium truncate max-w-xs" style={{ color: 'var(--reader-header-text)' }}>{book.title}</h1>
          {totalPages > 0 && (
            <span className="text-xs shrink-0" style={{ color: 'var(--reader-header-sub)' }}>
              {currentPage} / {totalPages}
              {progressPct > 0 && <span className="ml-1 text-indigo-500">{progressPct}%</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowAnnotations(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all duration-200 border"
            style={showAnnotations ? {
              background: 'var(--reader-btn-active-ann)',
              color: 'var(--reader-btn-active-ann-text)',
              borderColor: 'var(--reader-btn-active-ann-border)',
            } : {
              background: 'var(--reader-btn-inactive)',
              color: 'var(--reader-btn-inactive-text)',
              borderColor: 'transparent',
            }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            {t(language, 'annotations')}
          </button>
          <button
            onClick={() => setShowAI(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all duration-200 border"
            style={showAI ? {
              background: 'var(--reader-btn-active-ai)',
              color: 'var(--reader-btn-active-ai-text)',
              borderColor: 'var(--reader-btn-active-ai-border)',
            } : {
              background: 'var(--reader-btn-inactive)',
              color: 'var(--reader-btn-inactive-text)',
              borderColor: 'transparent',
            }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            {t(language, 'aiAssistant')}
          </button>
          {/* Re-analyze */}
          <button
            onClick={() => { localStorage.removeItem(`last-analysis-${book.id}`); runAnalysis(); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-all border"
            style={{ color: 'var(--reader-btn-inactive-text)', borderColor: 'transparent', background: 'var(--reader-btn-inactive)' }}
            title="重新 AI 分析全书"
            disabled={!!analysisStatus && analysisStatus.status !== 'done' && analysisStatus.status !== 'error'}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            重新分析
          </button>
          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--reader-btn-inactive-text)' }}
            title="设置"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Reading progress bar */}
      {totalPages > 0 && (
        <div className="h-0.5 shrink-0" style={{ background: 'var(--reader-progress-track)' }}>
          <div
            className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Reader area */}
        <div className="flex-1 overflow-hidden">
          {book.format === 'pdf' && (
            <PdfReader
              fileData={book.fileData}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              onTotalPages={setTotalPages}
              onTextSelect={handleTextSelect}
              onPageTextsReady={setPageTexts}
              onDeleteAnnotation={handleDeleteAnnotation}
              annotations={state.annotations.filter(a => a.bookId === book.id).map(a => ({
                id: a.id,
                text: a.text,
                color: a.color,
                page: a.page ?? 0,
                spans: a.spans,
              }))}
            />
          )}
          {book.format === 'epub' && (
            <EpubReader
              fileData={book.fileData}
              onTextSelect={handleTextSelect}
              onContentReady={handleContentReady}
            />
          )}
          {(book.format === 'txt' || book.format === 'md') && (
            <TextReader
              fileData={book.fileData}
              format={book.format}
              onTextSelect={handleTextSelect}
              onContentReady={handleContentReady}
            />
          )}
        </div>

        {/* Side panels — can both be open simultaneously, left edge draggable to resize */}
        {showAnnotations && (
          <div className="relative overflow-hidden shrink-0 flex border-l" style={{ width: annWidth, borderColor: 'var(--reader-panel-border)', background: 'var(--reader-panel-bg)' }}>
            {/* Drag handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-indigo-500/40 active:bg-indigo-500/60 transition-colors"
              onMouseDown={e => {
                e.preventDefault();
                draggingRef.current = { panel: 'ann', startX: e.clientX, startW: annWidth };
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            />
            <div className="flex-1 overflow-hidden">
              <AnnotationList
                bookId={book.id}
                bookTitle={book.title}
                bookContent={bookContent}
                onJumpToPage={handlePageChange}
                onJumpToAnnotation={scrollToAnnotation}
                onAnalyze={runAnalysis}
                analysisStatus={analysisStatus}
              />
            </div>
          </div>
        )}
        {showAI && (
          <div className="relative overflow-hidden flex flex-col shrink-0 border-l" style={{ width: aiWidth, borderColor: 'var(--reader-panel-border)', background: 'var(--reader-panel-bg)' }}>
            {/* Drag handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-indigo-500/40 active:bg-indigo-500/60 transition-colors"
              onMouseDown={e => {
                e.preventDefault();
                draggingRef.current = { panel: 'ai', startX: e.clientX, startW: aiWidth };
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            />
            <AIPanel bookId={book.id} bookContent={bookContent} bookTitle={book.title} pageTexts={pageTexts} onJumpToPage={handlePageChange} externalMessage={externalAiMessage} quotedText={quotedText} />
          </div>
        )}
      </div>

      {/* Text selection toolbar */}
      {selectedText && !showNoteEditor && (
        <TextSelection
          selectedText={selectedText}
          book={book}
          currentPage={currentPage}
          onAnnotate={handleManualAnnotate}
          onAIAnnotate={handleAIAnnotate}
          onSummarize={handleSummarize}
          onNote={handleOpenNoteEditor}
          onClose={() => setSelectedText('')}
          onAIResult={handleAIResult}
          onQuote={handleQuote}
          onHighlight={handleHighlight}
          onAnnotationSaved={() => {
            setShowAnnotations(true);
          }}
        />
      )}

      {/* Note editor popover */}
      {showNoteEditor && (
        <NoteEditor
          highlightText={selectedText}
          onSave={handleSaveNote}
          onClose={() => { setShowNoteEditor(false); setSelectedText(''); }}
        />
      )}

      {/* Settings modal */}
      {showSettings && (
        <Settings onClose={() => {
          setShowSettings(false);
          // After closing settings, retry analysis if key now exists
          if (localStorage.getItem('claude-api-key')) runAnalysis();
        }} />
      )}

      {/* Loading overlay */}
      {aiLoading && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 text-center shadow-2xl">
            <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm text-slate-300 font-medium">AI 正在分析</p>
            <p className="text-xs text-slate-500 mt-1">请稍候...</p>
          </div>
        </div>
      )}
    </div>
  );
}
