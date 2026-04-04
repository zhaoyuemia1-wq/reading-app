import { useCallback, useRef, useState } from 'react';
import { useBooks } from '../../contexts/BookContext';
import { detectFormat, generateId, readFileAsArrayBuffer, extractTitleFromFilename } from '../../services/fileParser';
import * as db from '../../services/db';
import { analyzeBook, type AnalysisProgress } from '../../services/bookAnalysis';
import type { Book } from '../../types';

export default function FileUpload() {
  const { dispatch } = useBooks();
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const format = detectFormat(file);
        const validFormats = ['pdf', 'epub', 'txt', 'md'];
        if (!validFormats.includes(format)) {
          setProgress({ status: 'error', message: `不支持的格式: ${file.name}（请上传 PDF/EPUB/TXT/MD）` });
          setTimeout(() => setProgress(null), 4000);
          continue;
        }

        setProgress({ status: 'extracting', message: `正在读取 ${file.name}...` });
        const fileData = await readFileAsArrayBuffer(file);
        const book: Book = {
          id: generateId(),
          title: extractTitleFromFilename(file.name),
          format,
          fileData,
          fileSize: file.size,
          addedAt: Date.now(),
          lastReadAt: Date.now(),
          progress: 0,
        };

        await db.saveBook(book);
        dispatch({ type: 'ADD_BOOK', payload: book });
        setProgress({ status: 'done', message: `✓ 已添加《${book.title}》` });
        setTimeout(() => setProgress(null), 3000);

        const apiKey = localStorage.getItem('claude-api-key');
        if (apiKey) {
          analyzeBook(book, (p) => {
            setProgress(p);
            if (p.status === 'done' || p.status === 'error') {
              setTimeout(() => setProgress(null), 4000);
            }
          });
        }
      } catch (err) {
        console.error('Upload error:', err);
        setProgress({ status: 'error', message: `上传失败: ${err instanceof Error ? err.message : '未知错误'}` });
        setTimeout(() => setProgress(null), 5000);
      }
    }
  }, [dispatch]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div className="space-y-3">
      <div
        className={`relative border-2 border-dashed rounded-2xl transition-all duration-200 group
          ${isDragging
            ? 'border-indigo-400 bg-indigo-500/5'
            : 'border-slate-700 hover:border-indigo-500/50 hover:bg-slate-800/20'
          }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.epub,.txt,.md"
          multiple
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />

        <div className="flex flex-col items-center justify-center py-8 px-6 gap-3">
          {/* Upload icon */}
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200
            ${isDragging ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500 group-hover:text-indigo-400 group-hover:bg-indigo-500/10'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>

          <div className="text-center">
            <p className={`text-sm font-medium mb-0.5 transition-colors ${isDragging ? 'text-indigo-300' : 'text-slate-300'}`}>
              {isDragging ? '松开即可上传' : '拖放文件到这里'}
            </p>
            <p className="text-slate-500 text-xs">支持 PDF · EPUB · TXT · Markdown</p>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-1 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
          >
            选择文件
          </button>

          {/* Format badges */}
          <div className="flex items-center gap-2 mt-1">
            {['PDF', 'EPUB', 'TXT', 'MD'].map((fmt) => (
              <span key={fmt} className="px-2 py-0.5 bg-slate-800 border border-slate-700/60 rounded text-xs text-slate-500 font-mono">
                .{fmt.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Analysis progress banner */}
      {progress && (
        <div className={`rounded-xl px-4 py-3 flex items-center gap-3 text-sm transition-all border
          ${progress.status === 'error'
            ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            : progress.status === 'done'
            ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
            : 'bg-indigo-950/40 border-indigo-800/60 text-indigo-300'
          }`}>
          {(progress.status === 'extracting' || progress.status === 'analyzing') && (
            <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          {progress.status === 'done' && (
            <div className="w-4 h-4 shrink-0 bg-emerald-500/20 rounded-full flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {progress.status === 'error' && (
            <div className="w-4 h-4 shrink-0 bg-rose-500/20 rounded-full flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs">{progress.message}</p>
            {progress.totalPages && progress.pagesExtracted && progress.status === 'extracting' && (
              <div className="mt-1.5 h-1 bg-indigo-900/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-400 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.pagesExtracted / progress.totalPages) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
