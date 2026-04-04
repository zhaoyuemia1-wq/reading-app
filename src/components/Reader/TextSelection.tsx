import { useState, useEffect, useRef, useCallback } from 'react';
import type { Book } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { t } from '../../i18n/translations';

interface Props {
  selectedText: string;
  book: Book;
  currentPage: number;
  onClose: () => void;
  onAnnotationSaved?: () => void;
  /** Called when an AI action completes — result goes to AI panel instead of annotation */
  onAIResult?: (userContent: string, assistantContent: string) => void;
  /** Called when user clicks "引用" — sends selected text as a quote to the AI chat */
  onQuote?: (text: string) => void;
  /** Called when user clicks "标注" — saves a plain yellow highlight with no prompt */
  onHighlight?: () => void;
  // Legacy props kept for backward compatibility
  onAnnotate?: () => void;
  onAIAnnotate?: () => void;
  onSummarize?: () => void;
  onNote?: () => void;
}

type ActionType = 'translate' | 'explain' | 'ask';

function getApiKey() {
  return localStorage.getItem('claude-api-key') || '';
}

async function callClaude(prompt: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message || `API 请求失败: ${res.status}`);
  }

  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text || '';
}


export default function TextSelection({
  selectedText,
  book: _book,
  currentPage: _currentPage,
  onClose,
  onAnnotationSaved: _onAnnotationSaved,
  onAIResult,
  onQuote,
  onHighlight,
}: Props) {
  const { language } = useTheme();
  const [loading, setLoading] = useState<ActionType | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [askInput, setAskInput] = useState('');
  const [showAskInput, setShowAskInput] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const askInputRef = useRef<HTMLInputElement>(null);

  // Cancel TTS when text changes or popup closes
  useEffect(() => {
    return () => {
      if (window.speechSynthesis?.speaking) {
        window.speechSynthesis.cancel();
      }
    };
  }, [selectedText]);

  // Position popup near the text selection
  useEffect(() => {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          const popupWidth = 360;
          const margin = 8;

          let left = rect.left + rect.width / 2 - popupWidth / 2;
          left = Math.max(margin, Math.min(left, window.innerWidth - popupWidth - margin));

          const estimatedPopupHeight = 130;
          let top: number;
          if (rect.top - estimatedPopupHeight - margin > 0) {
            top = rect.top - estimatedPopupHeight - margin + window.scrollY;
          } else {
            top = rect.bottom + margin + window.scrollY;
          }

          setPosition({ top, left });
          return;
        }
      }
    } catch {
      // ignore – fall back to bottom-centre
    }
    setPosition(null);
  }, [selectedText]);

  // Focus ask input when it appears
  useEffect(() => {
    if (showAskInput) {
      setTimeout(() => askInputRef.current?.focus(), 50);
    }
  }, [showAskInput]);

  // Close on outside click
  const handleOutsideClick = useCallback(
    (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [handleOutsideClick]);

  if (!selectedText) return null;

  const runAction = async (action: ActionType, question?: string) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      alert('⚠️ 请先设置 API Key');
      return;
    }

    // Build prompt sent to Claude
    let prompt = '';
    if (action === 'translate') {
      prompt = `请将以下句子翻译成中文，只给出翻译结果：\n\n${selectedText}`;
    } else if (action === 'explain') {
      prompt = `请详细解释以下句子的含义和重要性，用中文回答（2-3段）：\n\n${selectedText}`;
    } else {
      prompt = `书中这句话：「${selectedText}」\n\n用户问题：${question}\n\n请用中文详细回答。`;
    }

    // User-facing label shown in AI chat
    const snippet = selectedText.length > 60
      ? selectedText.slice(0, 60) + '…'
      : selectedText;
    const userLabel =
      action === 'translate' ? `翻译：「${snippet}」`
      : action === 'explain'  ? `解释：「${snippet}」`
      : `「${snippet}」— ${question}`;

    setLoading(action);
    try {
      const aiResponse = await callClaude(prompt);
      // Send to AI panel instead of saving as annotation
      if (onAIResult) {
        onAIResult(userLabel, aiResponse);
      }
      onClose();
    } catch (err) {
      if (err instanceof Error && err.message === 'NO_API_KEY') {
        alert('⚠️ 请先设置 API Key');
      } else {
        alert(err instanceof Error ? err.message : 'AI 请求失败');
      }
    } finally {
      setLoading(null);
    }
  };

  const handleAsk = () => {
    const q = askInput.trim();
    if (!q) return;
    runAction('ask', q);
  };

  const handleReadAloud = () => {
    if (!window.speechSynthesis) return;

    if (speaking || window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(selectedText);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const containerStyle: React.CSSProperties = position
    ? { position: 'fixed', top: position.top, left: position.left, width: 360, zIndex: 50 }
    : {};

  const containerClass = position
    ? 'animate-in fade-in zoom-in-95 duration-150'
    : 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[360px] animate-in slide-in-from-bottom-2 duration-200';

  return (
    <>
      {/* Popup */}
      <div ref={popupRef} className={containerClass} style={containerStyle}>
        <div className="bg-slate-800/97 backdrop-blur-md border border-slate-600/60 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
          {/* Selected text preview */}
          <div className="px-4 pt-3.5 pb-2.5 border-b border-slate-700/60 flex items-start gap-2">
            <div className="w-0.5 self-stretch min-h-[1rem] bg-indigo-500/60 rounded-full shrink-0 mt-0.5" />
            <p className="text-sm text-slate-400 line-clamp-2 flex-1 leading-relaxed italic">
              {selectedText.slice(0, 120)}{selectedText.length > 120 ? '…' : ''}
            </p>
            <button
              onClick={onClose}
              className="shrink-0 w-5 h-5 flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700 rounded transition-all"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* AI action buttons */}
          <div className="flex p-2 gap-1.5">
            {/* Highlight */}
            {onHighlight && (
              <AIActionButton
                label="标注"
                isLoading={false}
                disabled={loading !== null}
                colorClass="bg-amber-500/15 text-amber-400 hover:bg-amber-500/30 hover:text-amber-300"
                icon={
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M15.232 5.232l3.536 3.536-9.192 9.192-3.536-3.536 9.192-9.192zm-9.9 10.607l2.829 2.828-4.243 1.414 1.414-4.242zM20.707 3.293a1 1 0 010 1.414l-1.414 1.414-3.536-3.536 1.414-1.414a1 1 0 011.414 0l2.122 2.122z" />
                  </svg>
                }
                onClick={() => { onHighlight(); onClose(); }}
              />
            )}
            {/* Translate */}
            <AIActionButton
              label={t(language, 'translate')}
              isLoading={loading === 'translate'}
              disabled={loading !== null}
              colorClass="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
              icon={
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
              }
              onClick={() => runAction('translate')}
            />
            {/* Explain */}
            <AIActionButton
              label={t(language, 'explain')}
              isLoading={loading === 'explain'}
              disabled={loading !== null}
              colorClass="bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300"
              icon={
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              }
              onClick={() => runAction('explain')}
            />
            {/* Ask */}
            <AIActionButton
              label={t(language, 'ask')}
              isLoading={loading === 'ask'}
              disabled={loading !== null}
              colorClass={`bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300 ${showAskInput ? 'ring-1 ring-amber-500/40' : ''}`}
              icon={
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              }
              onClick={() => setShowAskInput(v => !v)}
            />
            {/* Quote to AI chat */}
            {onQuote && (
              <AIActionButton
                label="引用"
                isLoading={false}
                disabled={loading !== null}
                colorClass="bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-300"
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                }
                onClick={() => { onQuote(selectedText); onClose(); }}
              />
            )}
            {/* Read Aloud */}
            <AIActionButton
              label={speaking ? t(language, 'stopReading') : t(language, 'readAloud')}
              isLoading={false}
              disabled={loading !== null}
              colorClass={
                speaking
                  ? 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 ring-1 ring-violet-500/40'
                  : 'bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 hover:text-violet-300'
              }
              icon={
                speaking ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6a7 7 0 010 12M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                )
              }
              onClick={handleReadAloud}
            />
          </div>

          {/* Ask input area */}
          {showAskInput && (
            <div className="px-2 pb-2 flex gap-1.5 animate-in slide-in-from-top-1 duration-150">
              <input
                ref={askInputRef}
                type="text"
                value={askInput}
                onChange={e => setAskInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); }
                  if (e.key === 'Escape') { setShowAskInput(false); setAskInput(''); }
                }}
                placeholder={t(language, 'askPlaceholder')}
                disabled={loading === 'ask'}
                className="flex-1 bg-slate-900/80 border border-slate-700 focus:border-amber-500/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none transition-colors disabled:opacity-50"
              />
              <button
                onClick={handleAsk}
                disabled={!askInput.trim() || loading === 'ask'}
                className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
              >
                {loading === 'ask' ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : t(language, 'send')}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function AIActionButton({
  label,
  icon,
  isLoading,
  disabled,
  colorClass,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  isLoading: boolean;
  disabled: boolean;
  colorClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 px-1.5 rounded-xl text-sm font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${colorClass}`}
    >
      {isLoading ? (
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      ) : icon}
      <span className="truncate w-full text-center">{label}</span>
    </button>
  );
}
