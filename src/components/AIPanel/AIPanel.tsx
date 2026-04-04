import { useState, useEffect, useRef, useCallback } from 'react';
import { useBooks } from '../../contexts/BookContext';
import * as db from '../../services/db';
import * as ai from '../../services/ai';
import type { Highlight, MindMapNode, ImageAttachment } from '../../services/ai';
import { generateId } from '../../services/fileParser';
import type { ChatMessage, ChapterRecommendation } from '../../types';
import { getBookIndex, findRelevantPages } from '../../services/bookIndex';
import MindMap from './MindMap';

interface Props {
  bookId: string;
  bookContent: string;
  bookTitle?: string;
  pageTexts?: Record<number, string>;
  onJumpToPage?: (page: number) => void;
  /** Message injected from text selection (translate / explain / ask) */
  externalMessage?: { userContent: string; assistantContent: string; id: string } | null;
  /** Explicitly quoted text (from "引用" button) — shown as a quote bar in the chat input */
  quotedText?: { text: string; id: string } | null;
}

type Tab = 'chat' | 'find' | 'recommend' | 'highlights' | 'mindmap';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  {
    key: 'chat',
    label: '问答',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
  {
    key: 'find',
    label: '找页',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
      </svg>
    ),
  },
  {
    key: 'recommend',
    label: '推荐',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    ),
  },
  {
    key: 'highlights',
    label: '重点',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    ),
  },
  {
    key: 'mindmap',
    label: '导图',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
];

// Find which page a quote appears on
function findPageForQuote(quote: string, pageTexts: Record<number, string>): number | null {
  if (!quote || quote === 'null') return null;
  const normalizedQuote = quote.toLowerCase().replace(/[''""]/g, '"');
  const quoteWords = normalizedQuote.split(/\s+/).filter(w => w.length > 4);
  if (quoteWords.length === 0) return null;

  let bestPage: number | null = null;
  let bestScore = 0;
  for (const [page, text] of Object.entries(pageTexts)) {
    const normalizedText = text.toLowerCase();
    const matchCount = quoteWords.filter(w => normalizedText.includes(w)).length;
    const score = matchCount / quoteWords.length;
    if (score > 0.55 && score > bestScore) {
      bestScore = score;
      bestPage = parseInt(page);
    }
  }
  return bestPage;
}

export default function AIPanel({ bookId, bookContent, bookTitle = '本书', pageTexts = {}, onJumpToPage, externalMessage, quotedText }: Props) {
  const { dispatch } = useBooks();
  const [tab, setTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgSourcePages, setMsgSourcePages] = useState<Record<string, number>>({});
  const [msgSourceQuotes, setMsgSourceQuotes] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [activeQuote, setActiveQuote] = useState('');
  const [uploadedImage, setUploadedImage] = useState<ImageAttachment & { preview: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recommendations, setRecommendations] = useState<ChapterRecommendation[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [findQuery, setFindQuery] = useState('');
  const [findResults, setFindResults] = useState<Array<{ page: number; text: string; score?: number }>>([]);
  const [findLoading, setFindLoading] = useState(false);
  const [mindMap, setMindMap] = useState<MindMapNode | null>(null);
  const [mindMapLoading, setMindMapLoading] = useState(false);
  const [mindMapError, setMindMapError] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    db.getChatMessages(bookId).then(setMessages);
  }, [bookId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Inject messages from text-selection actions (translate / explain / ask)
  useEffect(() => {
    if (!externalMessage) return;
    setTab('chat');
    const userMsg: ChatMessage = {
      id: generateId(),
      bookId,
      role: 'user',
      content: externalMessage.userContent,
      timestamp: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: generateId(),
      bookId,
      role: 'assistant',
      content: externalMessage.assistantContent,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    db.saveChatMessage(userMsg);
    db.saveChatMessage(assistantMsg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalMessage?.id]); // only trigger on new message id

  // When user clicks "引用" button, show text as a quote bar and switch to chat tab
  useEffect(() => {
    if (!quotedText) return;
    setActiveQuote(quotedText.text.trim());
    setTab('chat');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotedText?.id]); // trigger on each new quote id

  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(',')[1];
      setUploadedImage({ data: base64, mediaType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) handleImageFile(file);
    }
  }, [handleImageFile]);

  const handleSend = async () => {
    if ((!input.trim() && !uploadedImage) || loading) return;
    const question = input.trim() || '请描述这张图片与本书的关联';
    const quote = activeQuote;
    const image = uploadedImage ? { data: uploadedImage.data, mediaType: uploadedImage.mediaType } : undefined;
    setInput('');
    setActiveQuote('');
    setUploadedImage(null);

    // If user has quoted text, include it as context in the displayed message
    const displayContent = quote
      ? `「${quote.length > 120 ? quote.slice(0, 120) + '…' : quote}」\n\n${question}`
      : question;
    // For the AI prompt, also include the full quote if available
    const promptContent = quote
      ? `关于这段文字：「${quote}」\n\n${question}`
      : question;

    const userMsg: ChatMessage = {
      id: generateId(),
      bookId,
      role: 'user',
      content: displayContent,
      imagePreview: image ? `data:${image.mediaType};base64,${image.data}` : undefined,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    dispatch({ type: 'ADD_CHAT_MESSAGE', payload: userMsg });
    await db.saveChatMessage(userMsg);

    setLoading(true);
    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const hasPdfPages = Object.keys(pageTexts).length > 0;
      let answer: string;
      let sourceQuote: string | null = null;

      if (hasPdfPages) {
        const result = await ai.chatAboutBookWithSource(bookContent, promptContent, history, image);
        answer = result.answer;
        sourceQuote = result.sourceQuote;
      } else {
        answer = await ai.chatAboutBook(bookContent, promptContent, history, image);
      }

      const assistantMsg: ChatMessage = {
        id: generateId(),
        bookId,
        role: 'assistant',
        content: answer,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      dispatch({ type: 'ADD_CHAT_MESSAGE', payload: assistantMsg });
      await db.saveChatMessage(assistantMsg);

      // Find source page and attach to message
      if (sourceQuote && hasPdfPages) {
        const foundPage = findPageForQuote(sourceQuote, pageTexts);
        if (foundPage) {
          setMsgSourcePages(prev => ({ ...prev, [assistantMsg.id]: foundPage }));
          setMsgSourceQuotes(prev => ({ ...prev, [assistantMsg.id]: sourceQuote! }));
        }
      }
    } catch (err) {
      const errMsg: ChatMessage = {
        id: generateId(),
        bookId,
        role: 'assistant',
        content: `错误: ${err instanceof Error ? err.message : '请求失败'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleRecommend = async () => {
    if (loading || !bookContent) return;
    setLoading(true);
    try {
      const profile = ai.getReadingProfile();
      const recs = await ai.recommendChapters(bookContent, profile.interests, profile.goal);
      setRecommendations(recs);
    } catch (err) {
      alert(err instanceof Error ? err.message : '推荐失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoHighlight = async () => {
    if (loading || !bookContent) return;
    setLoading(true);
    try {
      const keys = await ai.autoHighlightKeyPoints(bookContent);
      setHighlights(keys);
    } catch (err) {
      alert(err instanceof Error ? err.message : '标注失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFindPage = async () => {
    if (!findQuery.trim() || findLoading) return;
    setFindLoading(true);
    setFindResults([]);
    try {
      const index = await getBookIndex(bookId);
      if (index) {
        const results = findRelevantPages(index, findQuery, 5);
        setFindResults(results);
      } else if (bookContent) {
        const prompt = `书籍内容（节选）：\n${bookContent.slice(0, 8000)}\n\n问题：${findQuery}\n\n请告诉我书中哪些页码或段落回答了这个问题。直接给出简短答案。`;
        const answer = await ai.chatAboutBook(bookContent, prompt, []);
        setFindResults([{ page: 0, text: answer }]);
      } else {
        setFindResults([{ page: 0, text: '请先等待书籍内容加载，或先打开 AI 助手' }]);
      }
    } catch (err) {
      setFindResults([{ page: 0, text: `查找失败：${err instanceof Error ? err.message : '未知错误'}` }]);
    } finally {
      setFindLoading(false);
    }
  };

  const handleGenerateMindMap = async () => {
    if (mindMapLoading || !bookContent) return;
    setMindMapLoading(true);
    setMindMapError('');
    try {
      const result = await ai.generateMindMap(bookTitle, bookContent);
      setMindMap(result);
      // Save to localStorage so export can include it
      try { localStorage.setItem(`mindmap_${bookId}`, JSON.stringify(result)); } catch { /* ignore */ }
    } catch (err) {
      setMindMapError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setMindMapLoading(false);
    }
  };

  const priorityConfig = {
    high: { label: '必读', className: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
    medium: { label: '推荐', className: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    low: { label: '可选', className: 'text-slate-400 bg-slate-500/10 border-slate-600/30' },
  };

  const highlightTypeConfig = {
    insight: { label: '洞察', color: '#fbbf24' },
    action: { label: '行动', color: '#60a5fa' },
    concept: { label: '概念', color: '#a78bfa' },
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--reader-panel-bg, #0f172a)', color: 'var(--reader-header-text, #e2e8f0)' }}>
      {/* Tabs */}
      <div className="flex items-center border-b shrink-0 px-1 pt-1 gap-0.5" style={{ borderColor: 'var(--reader-panel-border, rgba(255,255,255,0.07))', background: 'var(--reader-panel-bg, #111827)' }}>
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 flex-1 justify-center py-2 px-1 text-xs font-medium rounded-t-lg transition-all duration-150 ${
              tab === key
                ? 'text-indigo-400 bg-slate-900 border-b-2 border-indigo-500'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
            }`}
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Chat tab */}
      {tab === 'chat' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="py-8">
                <div className="text-center mb-4">
                  <div className="w-10 h-10 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <p className="text-slate-400 text-sm font-medium">AI 读书助手</p>
                  <p className="text-slate-600 text-xs mt-1">向 AI 提问关于这本书的任何问题</p>
                </div>
                <div className="space-y-1.5">
                  {['这本书的核心观点是什么？', '总结当前章节', '解释这个概念'].map(q => (
                    <button
                      key={q}
                      onClick={() => setInput(q)}
                      className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 rounded-lg transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map(msg => {
              const sourcePage = msgSourcePages[msg.id];
              const sourceQuote = msgSourceQuotes[msg.id];
              return (
                <div key={msg.id} className={`${msg.role === 'user' ? 'ml-6' : 'mr-2'}`}>
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-4 h-4 bg-indigo-500/20 rounded-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full" />
                      </div>
                      <span className="text-xs text-slate-600">AI</span>
                    </div>
                  )}
                  <div
                    className="rounded-xl px-3 py-2.5 text-base leading-relaxed"
                    style={msg.role === 'user'
                      ? { background: 'rgba(99,102,241,0.12)', color: '#1e1b4b', border: '1px solid rgba(99,102,241,0.25)' }
                      : { background: 'rgba(30,34,50,0.75)', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.08)' }
                    }
                  >
                    {msg.imagePreview && (
                      <img src={msg.imagePreview} alt="uploaded" className="max-h-40 rounded-lg mb-2 object-contain" />
                    )}
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  {/* Source page reference */}
                  {msg.role === 'assistant' && sourcePage && (
                    <div className="mt-1.5 flex items-start gap-2">
                      <button
                        onClick={() => onJumpToPage?.(sourcePage)}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-400 text-xs rounded-lg transition-all group"
                      >
                        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="font-medium">第 {sourcePage} 页</span>
                        <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </button>
                      {sourceQuote && (
                        <p className="text-xs text-slate-500 leading-relaxed italic flex-1 pt-0.5 line-clamp-2">
                          "{sourceQuote.slice(0, 80)}{sourceQuote.length > 80 ? '…' : ''}"
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {loading && tab === 'chat' && (
              <div className="mr-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-4 h-4 bg-indigo-500/20 rounded-full flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
                  </div>
                  <span className="text-xs text-slate-600">AI</span>
                </div>
                <div className="rounded-xl px-3 py-2.5 text-base" style={{ background: 'rgba(30,34,50,0.75)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                  </span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="border-t border-slate-700/60 bg-slate-800/20">
            {/* Quote bar */}
            {activeQuote && (
              <div className="flex items-start gap-2 px-3 pt-2.5 pb-0 animate-in slide-in-from-bottom-1 duration-150">
                <div className="w-0.5 self-stretch bg-indigo-500/60 rounded-full shrink-0 mt-0.5" />
                <p className="flex-1 text-xs text-slate-400 italic leading-relaxed line-clamp-2">
                  {activeQuote.length > 100 ? activeQuote.slice(0, 100) + '…' : activeQuote}
                </p>
                <button
                  onClick={() => setActiveQuote('')}
                  className="shrink-0 w-4 h-4 flex items-center justify-center text-slate-600 hover:text-slate-300 rounded transition-colors mt-0.5"
                  title="取消引用"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            {/* Image preview */}
            {uploadedImage && (
              <div className="flex items-start gap-2 px-3 pt-2 pb-0">
                <div className="relative">
                  <img src={uploadedImage.preview} alt="preview" className="h-16 rounded-lg object-contain border border-slate-600" />
                  <button
                    onClick={() => setUploadedImage(null)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-slate-700 hover:bg-slate-600 rounded-full flex items-center justify-center text-slate-300"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
            <div className="flex gap-2 p-3">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }}
              />
              {/* Upload image button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                title="上传截图"
                className="shrink-0 px-2 py-2 text-slate-500 hover:text-slate-300 hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-40"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                onPaste={handlePaste}
                placeholder={uploadedImage ? '描述这张图片或直接发送…' : activeQuote ? '针对选中内容提问…' : '输入问题，或粘贴截图…'}
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-base text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                disabled={loading}
              />
              <button
                onClick={handleSend}
                disabled={loading || (!input.trim() && !uploadedImage)}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Find Page tab */}
      {tab === 'find' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto p-3">
            {findResults.length === 0 && !findLoading && (
              <div className="text-center py-10">
                <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3 border border-slate-700">
                  <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                </div>
                <p className="text-slate-500 text-sm font-medium mb-1">智能找页</p>
                <p className="text-slate-600 text-xs mb-3">输入任意问题，找到书中对应页码</p>
                <div className="space-y-1.5">
                  {['人的情感分哪些种', '如何掌控愤怒', '什么是内感受'].map(q => (
                    <button
                      key={q}
                      onClick={() => setFindQuery(q)}
                      className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 rounded-lg transition-all"
                    >
                      "{q}"
                    </button>
                  ))}
                </div>
              </div>
            )}

            {findLoading && (
              <div className="flex flex-col items-center py-12 gap-3">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-slate-500">搜索中...</p>
              </div>
            )}

            {findResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-slate-600 mb-3">找到 {findResults.length} 个相关位置</p>
                {findResults.map((r, i) => (
                  <div key={i} className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-3">
                    {r.page > 0 && (
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          onClick={() => onJumpToPage?.(r.page)}
                          className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                          第 {r.page} 页
                        </button>
                        {r.score !== undefined && (
                          <span className="text-xs text-slate-600">相关度 {Math.round(r.score * 100)}%</span>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-slate-300 leading-relaxed line-clamp-4">{r.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 border-t border-slate-700/60 bg-slate-800/20 shrink-0">
            <div className="flex gap-2">
              <input
                value={findQuery}
                onChange={e => setFindQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleFindPage()}
                placeholder="这本书哪里讲了…"
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-base text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                disabled={findLoading}
              />
              <button
                onClick={handleFindPage}
                disabled={findLoading || !findQuery.trim()}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm disabled:opacity-40 transition-colors"
              >
                {findLoading ? (
                  <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recommend tab */}
      {tab === 'recommend' && (
        <div className="flex-1 overflow-auto p-3">
          {recommendations.length === 0 ? (
            <div className="flex flex-col items-center py-10">
              <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center mb-3 border border-slate-700">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <p className="text-slate-400 text-sm font-medium mb-1">章节推荐</p>
              <p className="text-slate-600 text-xs mb-5 text-center">根据你的兴趣，推荐最值得阅读的章节</p>
              <button
                onClick={handleRecommend}
                disabled={loading || !bookContent}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm disabled:opacity-40 transition-colors flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                    分析中...
                  </>
                ) : '获取推荐'}
              </button>
              {!bookContent && (
                <p className="text-xs text-slate-600 mt-3">等待内容加载...</p>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-500 mb-3">根据你的阅读偏好推荐：</p>
              {recommendations.map((rec, i) => {
                const config = priorityConfig[rec.priority];
                return (
                  <div key={i} className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${config.className}`}>
                        {config.label}
                      </span>
                      <span className="text-sm font-medium text-slate-200 line-clamp-1">{rec.chapter}</span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{rec.reason}</p>
                  </div>
                );
              })}
              <button
                onClick={handleRecommend}
                disabled={loading}
                className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-xl transition-all"
              >
                重新推荐
              </button>
            </div>
          )}
        </div>
      )}

      {/* Auto-highlight tab */}
      {tab === 'highlights' && (
        <div className="flex-1 overflow-auto p-3">
          {highlights.length === 0 ? (
            <div className="flex flex-col items-center py-10">
              <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center mb-3 border border-slate-700">
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
              </div>
              <p className="text-slate-400 text-sm font-medium mb-1">AI 自动标注</p>
              <p className="text-slate-600 text-xs mb-5 text-center">AI 找出书中最值得关注的重点内容</p>
              <button
                onClick={handleAutoHighlight}
                disabled={loading || !bookContent}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm disabled:opacity-40 transition-colors flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                    分析中...
                  </>
                ) : '自动标注重点'}
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-500 mb-3">AI 认为最值得关注的内容：</p>
              {highlights.map((h, i) => {
                const typeInfo = highlightTypeConfig[h.type] ?? { label: h.type, color: h.color };
                return (
                  <div
                    key={i}
                    className="rounded-xl p-3 border"
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor: h.color,
                      borderTopColor: `${h.color}20`,
                      borderRightColor: `${h.color}20`,
                      borderBottomColor: `${h.color}20`,
                      backgroundColor: `${h.color}0a`,
                    }}
                  >
                    <p className="text-xs font-medium mb-1.5" style={{ color: h.color }}>
                      {typeInfo.label}
                    </p>
                    <p className="text-sm text-slate-300 leading-relaxed">"{h.text}"</p>
                  </div>
                );
              })}
              <button
                onClick={handleAutoHighlight}
                disabled={loading}
                className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-xl transition-all"
              >
                重新分析
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mind Map tab */}
      {tab === 'mindmap' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {!mindMap && !mindMapLoading && (
            <div className="flex flex-col items-center justify-center flex-1 px-4">
              <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center mb-4 border border-slate-700">
                <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </div>
              <p className="text-slate-300 text-sm font-medium mb-1">AI 思维导图</p>
              <p className="text-slate-500 text-xs text-center mb-6 leading-relaxed">
                AI 分析书籍内容，<br />自动生成核心概念的可视化思维导图
              </p>
              {mindMapError && (
                <p className="text-xs text-rose-400 mb-4 text-center bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  {mindMapError}
                </p>
              )}
              <button
                onClick={handleGenerateMindMap}
                disabled={!bookContent}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm disabled:opacity-40 transition-all font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                生成思维导图
              </button>
              {!bookContent && (
                <p className="text-xs text-slate-600 mt-3">等待内容加载...</p>
              )}
            </div>
          )}

          {mindMapLoading && (
            <div className="flex flex-col items-center justify-center flex-1 gap-4">
              <div className="relative w-12 h-12">
                <div className="w-12 h-12 border-2 border-indigo-500/30 rounded-full" />
                <div className="absolute inset-0 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-slate-300 text-sm font-medium">AI 正在分析书籍</p>
                <p className="text-slate-600 text-xs mt-1">构建概念地图中...</p>
              </div>
            </div>
          )}

          {mindMap && !mindMapLoading && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Mind map header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/60 shrink-0">
                <p className="text-xs text-slate-400 font-medium">{bookTitle} — 思维导图</p>
                <button
                  onClick={() => { setMindMap(null); setMindMapError(''); }}
                  className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
                >
                  重新生成
                </button>
              </div>
              {/* Mind map canvas */}
              <div className="flex-1 overflow-hidden">
                <MindMap data={mindMap} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
