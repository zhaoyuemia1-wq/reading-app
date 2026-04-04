import { useState, useRef, useEffect } from 'react';

interface Props {
  highlightText: string;
  onSave: (text: string, tags: string[]) => void;
  onClose: () => void;
}

export default function NoteEditor({ highlightText, onSave, onClose }: Props) {
  const [text, setText] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) {
      setTags(prev => [...prev, t]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(prev => prev.slice(0, -1));
    }
  };

  const handleSave = () => {
    if (!text.trim()) return;
    onSave(text.trim(), tags);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-teal-500/20 rounded-md flex items-center justify-center">
              <svg className="w-3 h-3 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="text-sm font-medium text-slate-200">新建笔记</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700 rounded-lg transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Highlight excerpt */}
          <div>
            <p className="text-xs text-slate-500 mb-1.5 font-medium">划线原文</p>
            <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-3.5 py-2.5">
              <p className="text-sm text-amber-300/80 line-clamp-3 leading-relaxed">
                {highlightText.slice(0, 200)}{highlightText.length > 200 ? '…' : ''}
              </p>
            </div>
          </div>

          {/* Note textarea */}
          <div>
            <p className="text-xs text-slate-500 mb-1.5 font-medium">笔记内容</p>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="写下你的想法、感悟、疑问…"
              rows={4}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none transition-colors"
            />
          </div>

          {/* Tags */}
          <div>
            <p className="text-xs text-slate-500 mb-1.5 font-medium">标签</p>
            <div className="bg-slate-900/60 border border-slate-700 focus-within:border-indigo-500 rounded-xl px-3 py-2 transition-colors min-h-[40px]">
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-xs rounded-full"
                  >
                    #{tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="hover:text-white transition-colors leading-none w-3.5 h-3.5 flex items-center justify-center"
                    >
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder={tags.length === 0 ? '输入标签，回车添加…' : '再添加…'}
                className="bg-transparent text-sm text-slate-300 placeholder-slate-600 focus:outline-none w-full"
              />
            </div>
            <p className="text-xs text-slate-600 mt-1">按 Enter 或逗号添加标签</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!text.trim()}
            className="flex-1 py-2.5 text-sm text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors font-medium"
          >
            保存笔记
          </button>
        </div>
      </div>
    </div>
  );
}
