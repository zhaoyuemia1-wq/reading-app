import { useState, useRef } from 'react';
import { searchBooks, getCoverUrl, type BookSearchResult } from '../../services/bookSearch';
import { useBooks } from '../../contexts/BookContext';
import * as db from '../../services/db';
import { generateId } from '../../services/fileParser';
import type { Book } from '../../types';

export default function BookSearch() {
  const { dispatch } = useBooks();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedKeys, setImportedKeys] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await searchBooks(q);
        setResults(res);
        if (res.length === 0) setError('没有找到相关书籍');
      } catch (err) {
        setError(err instanceof Error ? err.message : '搜索失败，请稍后重试');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);
  };

  const handleImport = async (result: BookSearchResult) => {
    const lines = [
      `# ${result.title}`,
      `作者：${result.author}`,
      result.year ? `出版年份：${result.year}` : '',
      result.description ? `\n${result.description}` : '',
      '',
      '（此书从 Open Library 导入，仅包含书目信息。请上传完整文件以阅读全文。）',
    ].filter(l => l !== undefined && !(l === '' && !result.description));

    const content = lines.join('\n');
    const encoder = new TextEncoder();
    const fileData = encoder.encode(content).buffer as ArrayBuffer;

    const book: Book = {
      id: generateId(),
      title: result.title,
      format: 'txt',
      fileData,
      fileSize: fileData.byteLength,
      addedAt: Date.now(),
      lastReadAt: Date.now(),
      progress: 0,
    };

    await db.saveBook(book);
    dispatch({ type: 'ADD_BOOK', payload: book });
    setImportedKeys(prev => new Set(prev).add(result.key));
  };

  return (
    <div className="mt-6">
      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder="搜索书名或作者…"
          className="w-full bg-slate-800 border border-slate-700 hover:border-slate-600 focus:border-indigo-500 rounded-xl px-4 py-3 pl-10 text-slate-200 placeholder-slate-500 focus:outline-none transition-colors text-sm"
        />
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        {loading && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        )}
        {query && !loading && (
          <button
            onClick={() => { setQuery(''); setResults([]); setError(null); }}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Error */}
      {error && !loading && (
        <p className="mt-3 text-sm text-slate-500 text-center">{error}</p>
      )}

      {/* Results grid */}
      {results.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-slate-500 mb-3">找到 {results.length} 本书</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {results.map(result => (
              <div
                key={result.key}
                className="group bg-slate-800 border border-slate-700/50 hover:border-slate-600 rounded-xl overflow-hidden flex flex-col transition-all hover:shadow-lg hover:shadow-black/30"
              >
                {/* Cover */}
                <div className="aspect-[2/3] bg-slate-700 flex items-center justify-center overflow-hidden relative">
                  {result.coverId ? (
                    <img
                      src={getCoverUrl(result.coverId)}
                      alt={result.title}
                      className="w-full h-full object-cover"
                      onError={e => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 px-2 text-center">
                      <svg className="w-8 h-8 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      <span className="text-slate-500 text-xs">无封面</span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-2.5 flex flex-col flex-1 gap-1">
                  <p
                    className="text-slate-200 text-xs font-medium line-clamp-2 leading-tight"
                    title={result.title}
                  >
                    {result.title}
                  </p>
                  <p className="text-slate-500 text-xs line-clamp-1">{result.author}</p>
                  {result.year && (
                    <p className="text-slate-600 text-xs">{result.year}</p>
                  )}
                  <button
                    onClick={() => handleImport(result)}
                    disabled={importedKeys.has(result.key)}
                    className={`mt-auto w-full py-1.5 text-xs rounded-lg transition-all font-medium ${
                      importedKeys.has(result.key)
                        ? 'bg-slate-700 text-slate-500 cursor-default'
                        : 'bg-indigo-600/15 text-indigo-400 hover:bg-indigo-600/25 hover:text-indigo-300 border border-indigo-500/20'
                    }`}
                  >
                    {importedKeys.has(result.key) ? '已导入' : '导入书架'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
