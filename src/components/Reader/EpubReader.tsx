import { useEffect, useRef, useState } from 'react';
import ePub, { type Book as EpubBook, type Rendition } from 'epubjs';

interface Props {
  fileData: ArrayBuffer;
  onTextSelect: (text: string, context: string) => void;
  onContentReady: (text: string) => void;
}

interface TocItem {
  label: string;
  href: string;
}

export default function EpubReader({ fileData, onTextSelect, onContentReady }: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [currentChapter, setCurrentChapter] = useState('');

  useEffect(() => {
    if (!viewerRef.current) return;

    const book = ePub(fileData);
    bookRef.current = book;

    const rendition = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: 'none',
    });

    renditionRef.current = rendition;
    rendition.display();

    // Style the content for dark mode
    rendition.themes.default({
      body: {
        color: '#e2e8f0 !important',
        background: 'transparent !important',
        'font-family': "'Inter', -apple-system, sans-serif !important",
        'line-height': '1.8 !important',
        'font-size': '18px !important',
        padding: '20px !important',
      },
      'a': { color: '#818cf8 !important' },
      'h1, h2, h3': { color: '#f1f5f9 !important' },
    });

    // Load table of contents
    book.loaded.navigation.then(nav => {
      const items = nav.toc.map(item => ({
        label: item.label.trim(),
        href: item.href,
      }));
      setToc(items);
    });

    // Track chapter changes
    rendition.on('relocated', (location: { start: { href: string } }) => {
      const chapter = toc.find(t => location.start.href.includes(t.href));
      if (chapter) setCurrentChapter(chapter.label);
    });

    // Text selection
    rendition.on('selected', (cfiRange: string) => {
      const range = rendition.getRange(cfiRange);
      const text = range.toString().trim();
      if (text) {
        onTextSelect(text, `EPUB - ${currentChapter || '当前章节'}`);
      }
    });

    // Extract full text for AI
    book.loaded.spine.then(async () => {
      let fullText = '';
      const spine = book.spine as unknown as { each: (fn: (item: { load: (resolver: unknown) => Promise<{ innerText: string }> }) => void) => void };
      spine.each((item) => {
        item.load(book.load.bind(book)).then((doc) => {
          fullText += doc.innerText + '\n';
          onContentReady(fullText);
        });
      });
    });

    return () => {
      book.destroy();
    };
  }, [fileData]);

  const goNext = () => renditionRef.current?.next();
  const goPrev = () => renditionRef.current?.prev();
  const goToChapter = (href: string) => {
    renditionRef.current?.display(href);
    setShowToc(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800/80 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowToc(!showToc)} className="px-2 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded">
            目录
          </button>
          <span className="text-sm text-slate-400 truncate max-w-[200px]">{currentChapter}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="px-2 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded">上一页</button>
          <button onClick={goNext} className="px-2 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded">下一页</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* TOC sidebar */}
        {showToc && (
          <div className="w-64 bg-slate-800 border-r border-slate-700 overflow-auto">
            <div className="p-3">
              <h3 className="text-sm font-medium text-slate-400 mb-2">目录</h3>
              {toc.map((item, i) => (
                <button
                  key={i}
                  onClick={() => goToChapter(item.href)}
                  className="block w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 rounded truncate"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* EPUB content */}
        <div ref={viewerRef} className="flex-1" />
      </div>
    </div>
  );
}
