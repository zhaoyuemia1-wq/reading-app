import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

interface AnnotationHighlight {
  id: string;
  text: string;
  color: string;
  page: number;
  spans?: string[];
}

interface Props {
  fileData: ArrayBuffer;
  currentPage: number;
  onPageChange: (page: number) => void;
  onTotalPages: (total: number) => void;
  onTextSelect: (text: string, context: string, page?: number, spans?: string[]) => void;
  onPageTextsReady?: (texts: Record<number, string>) => void;
  onDeleteAnnotation?: (id: string) => void;
  annotations?: AnnotationHighlight[];
}

// ── TOC types ─────────────────────────────────────────────────────
interface TocItem {
  title: string;
  page: number;
  level: number;
  items: TocItem[];
}

// ── Build TOC from PDF outline ────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildToc(pdfDoc: PDFDocumentProxy, outlineItems: any[], level = 0): Promise<TocItem[]> {
  const result: TocItem[] = [];
  for (const item of outlineItems) {
    let page = 0;
    if (item.dest) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let dest: any = item.dest;
        if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
        if (Array.isArray(dest) && dest[0] != null) {
          page = (await pdfDoc.getPageIndex(dest[0])) + 1;
        }
      } catch { /* ignore */ }
    }
    const children: TocItem[] = item.items?.length
      ? await buildToc(pdfDoc, item.items, level + 1)
      : [];
    result.push({ title: item.title ?? '', page, level, items: children });
  }
  return result;
}

// ── Collapsible TOC node ──────────────────────────────────────────
function TocNode({
  item,
  currentPage,
  onJump,
}: {
  item: TocItem;
  currentPage: number;
  onJump: (page: number) => void;
}) {
  const [open, setOpen] = useState(item.level < 1); // top-level open by default
  const hasChildren = item.items.length > 0;
  const isActive = item.page > 0 && item.page === currentPage;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 px-2 rounded-lg cursor-pointer group transition-colors duration-100 ${
          isActive
            ? 'bg-indigo-500/20 text-indigo-300'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
        }`}
        style={{ paddingLeft: `${8 + item.level * 12}px` }}
        onClick={() => {
          if (item.page > 0) onJump(item.page);
          if (hasChildren) setOpen(v => !v);
        }}
      >
        {/* Collapse toggle */}
        {hasChildren ? (
          <span
            className="w-4 h-4 flex items-center justify-center shrink-0 text-slate-500"
            onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
          >
            <svg
              className={`w-2.5 h-2.5 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
              fill="currentColor"
              viewBox="0 0 6 10"
            >
              <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Title */}
        <span className="flex-1 text-[12px] leading-snug truncate">{item.title}</span>

        {/* Page number */}
        {item.page > 0 && (
          <span
            style={{ marginLeft: 8, marginRight: 8, flexShrink: 0 }}
            className={`text-[11px] font-mono tabular-nums ${isActive ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-500'}`}
          >
            {item.page}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && open && (
        <div>
          {item.items.map((child, i) => (
            <TocNode key={i} item={child} currentPage={currentPage} onJump={onJump} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Lazy thumbnail ────────────────────────────────────────────────
function LazyThumbnail({
  pageNum,
  isActive,
  onClick,
}: {
  pageNum: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '300px' },
    );
    if (divRef.current) observer.observe(divRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={divRef}
      onClick={onClick}
      className={`flex flex-col items-center py-2 px-2 cursor-pointer transition-colors duration-100 ${
        isActive ? 'bg-indigo-600/20' : 'hover:bg-white/5'
      }`}
    >
      <div
        className={`overflow-hidden rounded-sm shadow-lg transition-all duration-100 ${
          isActive ? 'ring-2 ring-indigo-500' : 'ring-1 ring-white/10'
        }`}
        style={{ width: 100 }}
      >
        {visible ? (
          <Page
            pageNumber={pageNum}
            width={100}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        ) : (
          <div style={{ width: 100, height: 130, background: '#2a2a3a' }} />
        )}
      </div>
      <span className={`text-[11px] mt-1.5 font-mono tabular-nums ${isActive ? 'text-indigo-300' : 'text-slate-500'}`}>
        {pageNum}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export default function PdfReader({
  fileData,
  currentPage,
  onPageChange,
  onTotalPages,
  onTextSelect,
  onPageTextsReady,
  onDeleteAnnotation,
  annotations = [],
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(208); // default w-52 = 208px
  const sidebarDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'toc' | 'thumbs'>('toc');
  const [toc, setToc] = useState<TocItem[]>([]);
  const [highlightPopup, setHighlightPopup] = useState<{ annId: string; x: number; y: number } | null>(null);
  // Intrinsic page dimensions (at scale=1) extracted on load.
  // Used to pre-set container heights so offsetTop is accurate before pages render.
  const [pageDims, setPageDims] = useState<Record<number, { w: number; h: number }>>({});

  const mainRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const programmaticRef = useRef(false);
  // True when the page change was triggered by the user scrolling (not TOC/annotation click).
  // The currentPage-watching effect uses this to skip re-scrolling in that case.
  const scrollTriggeredRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const currentPageRef = useRef(currentPage);
  const onPageChangeRef = useRef(onPageChange);
  currentPageRef.current = currentPage;
  onPageChangeRef.current = onPageChange;

  // Sidebar resize drag handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      const delta = e.clientX - sidebarDragRef.current.startX;
      const newW = Math.min(480, Math.max(140, sidebarDragRef.current.startW + delta));
      setSidebarWidth(newW);
    };
    const onUp = () => { sidebarDragRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // Two independent ArrayBuffer copies — one per Document instance
  const fileUrl = useMemo(() => ({ data: new Uint8Array(fileData.slice(0)) }), [fileData]);
  const sidebarFileUrl = useMemo(() => ({ data: new Uint8Array(fileData.slice(0)) }), [fileData]);

  // Per-page annotation hash — forces text layer re-render when annotations change for a page
  const annKeyByPage = useMemo(() => {
    const map: Record<number, string> = {};
    for (const ann of annotations) {
      if (ann.page > 0) map[ann.page] = (map[ann.page] ?? '') + ann.text.slice(0, 8);
    }
    return map;
  }, [annotations]);

  // Sync page input display
  useEffect(() => { setPageInput(String(currentPage)); }, [currentPage]);

  // Scroll-event page tracking.
  // Strategy: "most visible" — whichever page occupies the most vertical pixels
  // inside the scroll container viewport is the current page.
  // This is inherently stable: the counter can only change when another page
  // physically dominates more of the screen, so tiny scroll jitter never causes jumps.
  useEffect(() => {
    const container = mainRef.current;
    if (!container) return;

    const detectPage = () => {
      if (programmaticRef.current) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const cTop = container.scrollTop;
        const cBottom = cTop + container.clientHeight;

        let bestPage = 0;
        let maxVisible = 0;

        for (const [pageStr, el] of Object.entries(pageRefs.current)) {
          if (!el) continue;
          // Use offsetTop / offsetHeight — stable, no layout-shift from getBoundingClientRect
          const elTop = el.offsetTop;
          const elBottom = elTop + el.offsetHeight;
          const visTop = Math.max(elTop, cTop);
          const visBottom = Math.min(elBottom, cBottom);
          const visible = Math.max(0, visBottom - visTop);
          if (visible > maxVisible) {
            maxVisible = visible;
            bestPage = parseInt(pageStr);
          }
        }

        if (bestPage > 0 && bestPage !== currentPageRef.current) {
          scrollTriggeredRef.current = true; // mark as scroll-originated
          onPageChangeRef.current(bestPage);
        }
      });
    };

    container.addEventListener('scroll', detectPage, { passive: true });
    return () => {
      container.removeEventListener('scroll', detectPage);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — uses refs for callbacks, no need to re-attach

  // Auto-scroll the sidebar thumbnail list to keep current page visible
  useEffect(() => {
    if (!sidebarRef.current || sidebarTab !== 'thumbs') return;
    const el = sidebarRef.current.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentPage, sidebarTab]);

  const setPageRef = useCallback((el: HTMLDivElement | null, pageNum: number) => {
    pageRefs.current[pageNum] = el;
  }, []);

  // When currentPage changes externally (TOC click / annotation jump), scroll to that page.
  // If the change came from the scroll-detection itself, skip re-scrolling — the user
  // is already there; re-scrolling would cause the "snap back" jitter.
  const prevCurrentPage = useRef(currentPage);
  useEffect(() => {
    if (currentPage === prevCurrentPage.current) return;
    prevCurrentPage.current = currentPage;
    if (scrollTriggeredRef.current) {
      scrollTriggeredRef.current = false; // clear the flag, don't scroll
      return;
    }
    scrollToPageInstant(currentPage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // Instant scroll helper — no animation avoids the need for long programmatic locks.
  // Release the lock after one rAF so the immediately-fired scroll event is ignored.
  const scrollToPageInstant = useCallback((page: number) => {
    const el = pageRefs.current[page];
    const container = mainRef.current;
    if (!el || !container) return;
    programmaticRef.current = true;
    container.scrollTop = el.offsetTop;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { programmaticRef.current = false; });
    });
  }, []);

  const jumpToPage = useCallback((page: number) => {
    scrollToPageInstant(page);
    onPageChange(page);
  }, [scrollToPageInstant, onPageChange]);

  const handleDocLoad = async (pdfDoc: PDFDocumentProxy) => {
    setNumPages(pdfDoc.numPages);
    onTotalPages(pdfDoc.numPages);

    // Extract TOC outline
    try {
      const outline = await pdfDoc.getOutline();
      if (outline?.length) {
        const tocItems = await buildToc(pdfDoc, outline);
        setToc(tocItems);
      }
    } catch { /* no outline */ }

    // Extract page dimensions + text content in one pass.
    // Setting page dimensions immediately means all container heights are correct
    // before the PDF canvas renders, so offsetTop-based jumps are always accurate.
    try {
      const texts: Record<number, string> = {};
      const dims: Record<number, { w: number; h: number }> = {};
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        dims[i] = { w: vp.width, h: vp.height };
        const content = await page.getTextContent();
        texts[i] = content.items
          .filter(item => 'str' in item)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map(item => (item as any).str as string)
          .join(' ');
      }
      setPageDims(dims);
      onPageTextsReady?.(texts);
    } catch { /* ignore */ }
  };

  const handleTextSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || !sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    // Derive page from the DOM [data-page] ancestor of the selection start — always accurate
    const startNode = range.startContainer;
    const pageEl = (startNode as HTMLElement).closest?.('[data-page]')
      ?? (startNode.parentElement)?.closest('[data-page]');
    const domPage = pageEl
      ? parseInt(pageEl.getAttribute('data-page') ?? '0')
      : currentPageRef.current;

    // Capture exact span strings within the selection for precise re-highlighting
    const selectedSpans: string[] = [];
    if (pageEl) {
      const spans = pageEl.querySelectorAll<HTMLElement>('.textLayer span');
      for (const span of spans) {
        if (!span.textContent?.trim()) continue;
        try {
          const spanRange = document.createRange();
          spanRange.selectNodeContents(span);
          if (
            range.compareBoundaryPoints(Range.END_TO_START, spanRange) <= 0 &&
            range.compareBoundaryPoints(Range.START_TO_END, spanRange) >= 0
          ) {
            selectedSpans.push(span.textContent);
          }
        } catch { /* ignore */ }
      }
    }

    onTextSelect(text, `PDF 第 ${domPage} 页`, domPage, selectedSpans);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest('[data-ann-id]') as HTMLElement | null;
    if (!mark) return;
    e.preventDefault();
    const annId = mark.getAttribute('data-ann-id');
    if (annId) setHighlightPopup({ annId, x: e.clientX, y: e.clientY });
  };

  const handleMarkClick = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest('[data-ann-id]') as HTMLElement | null;
    if (!mark) { setHighlightPopup(null); return; }
    const annId = mark.getAttribute('data-ann-id');
    if (annId) setHighlightPopup({ annId, x: e.clientX, y: e.clientY });
  };

  const handlePageInputSubmit = () => {
    const n = parseInt(pageInput);
    if (!isNaN(n) && n >= 1 && n <= numPages) {
      jumpToPage(n);
    } else {
      setPageInput(String(currentPage));
    }
  };

  const customTextRenderer = useCallback(
    ({ str, pageNumber: pNum }: { str: string; pageNumber: number }) => {
      if (!str.trim()) return str;

      for (const ann of annotations.filter(a => a.page === pNum)) {
        let matched = false;

        if (ann.spans && ann.spans.length > 0) {
          // Precise match: check if this exact span string was recorded at selection time
          matched = ann.spans.includes(str);
        } else {
          // Fallback for old annotations without spans: require span is long enough
          // and represents a significant fraction of the annotation text
          const norm = (s: string) =>
            s.toLowerCase().replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
          const spanNorm = norm(str);
          const annNorm = norm(ann.text);
          matched =
            spanNorm.length >= 15 &&
            annNorm.includes(spanNorm) &&
            spanNorm.length / annNorm.length > 0.05; // span must be >5% of annotation
        }

        if (matched) {
          const hex = ann.color.replace('#', '');
          const r = parseInt(hex.slice(0, 2), 16);
          const g = parseInt(hex.slice(2, 4), 16);
          const b = parseInt(hex.slice(4, 6), 16);
          return `<span data-ann-id="${ann.id}" style="background-color:rgba(${r},${g},${b},0.42);cursor:pointer;">${str}</span>`;
        }
      }
      return str;
    },
    [annotations],
  );

  return (
    <div className="flex h-full" style={{ background: '#1a1a2e' }}>

      {/* ── Left sidebar ─────────────────────────────────── */}
      {showSidebar && (
        <div
          ref={sidebarRef}
          className="relative flex-shrink-0 flex flex-col border-r border-white/5"
          style={{ background: '#12121f', width: sidebarWidth }}
        >
          {/* Sidebar tab switcher + collapse button */}
          <div className="flex items-center border-b border-white/5 shrink-0">
            <button
              onClick={() => setSidebarTab('toc')}
              className={`flex-1 py-2 text-[12px] font-medium transition-colors ${
                sidebarTab === 'toc'
                  ? 'text-indigo-400 border-b-2 border-indigo-500'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              目录
            </button>
            <button
              onClick={() => setSidebarTab('thumbs')}
              className={`flex-1 py-2 text-[12px] font-medium transition-colors ${
                sidebarTab === 'thumbs'
                  ? 'text-indigo-400 border-b-2 border-indigo-500'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              页面
            </button>
            {/* Collapse button */}
            <button
              onClick={() => setShowSidebar(false)}
              className="w-7 h-7 flex items-center justify-center text-slate-600 hover:text-slate-300 hover:bg-white/8 rounded transition-colors mr-1 shrink-0"
              title="收起侧边栏"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* TOC view */}
          {sidebarTab === 'toc' && (
            <div className="flex-1 overflow-y-auto py-1">
              {toc.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                  <p className="text-slate-600 text-xs">此书暂无目录</p>
                </div>
              ) : (
                <div className="py-1">
                  {toc.map((item, i) => (
                    <TocNode
                      key={i}
                      item={item}
                      currentPage={currentPage}
                      onJump={jumpToPage}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Thumbnails view */}
          {sidebarTab === 'thumbs' && (
            <div className="flex-1 overflow-y-auto">
              <Document file={sidebarFileUrl} loading={null}>
                {numPages > 0 &&
                  Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
                    <div key={pageNum} data-thumb={pageNum}>
                      <LazyThumbnail
                        pageNum={pageNum}
                        isActive={pageNum === currentPage}
                        onClick={() => jumpToPage(pageNum)}
                      />
                    </div>
                  ))}
              </Document>
            </div>
          )}

          {/* Right drag handle */}
          <div
            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500/40 active:bg-indigo-500/60 transition-colors z-10"
            onMouseDown={e => {
              e.preventDefault();
              sidebarDragRef.current = { startX: e.clientX, startW: sidebarWidth };
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          />
        </div>
      )}

      {/* ── Right: toolbar + PDF content ─────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Toolbar */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0"
          style={{ background: '#12121f' }}
        >
          {/* Sidebar toggle */}
          <button
            onClick={() => setShowSidebar(v => !v)}
            className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/8 rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>

          {/* Page navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => jumpToPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-30 rounded hover:bg-white/8 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={pageInput}
                onChange={e => setPageInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePageInputSubmit()}
                onBlur={handlePageInputSubmit}
                className="w-10 text-center text-sm bg-white/8 border border-white/10 rounded px-1 py-0.5 text-white focus:outline-none focus:border-indigo-500 tabular-nums"
              />
              <span className="text-slate-500 text-sm">/</span>
              <span className="text-slate-400 text-sm tabular-nums">{numPages}</span>
            </div>

            <button
              onClick={() => jumpToPage(Math.min(numPages, currentPage + 1))}
              disabled={currentPage >= numPages}
              className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-30 rounded hover:bg-white/8 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setScale(s => Math.max(0.5, parseFloat((s - 0.1).toFixed(1))))}
              className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/8 rounded transition-colors text-base"
            >−</button>
            <span className="text-xs text-slate-400 w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setScale(s => Math.min(3, parseFloat((s + 0.1).toFixed(1))))}
              className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/8 rounded transition-colors text-base"
            >+</button>
          </div>
        </div>

        {/* Highlight delete popup */}
        {highlightPopup && (
          <div
            className="fixed z-50 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg shadow-xl text-xs font-medium"
            style={{ left: highlightPopup.x, top: highlightPopup.y - 40, background: '#1e1e2e', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.12)', transform: 'translateX(-50%)' }}
          >
            <button
              onClick={() => { onDeleteAnnotation?.(highlightPopup.annId); setHighlightPopup(null); }}
              className="flex items-center gap-1 text-rose-400 hover:text-rose-300 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              删除高光
            </button>
            <button onClick={() => setHighlightPopup(null)} className="ml-1 text-slate-500 hover:text-slate-300">✕</button>
          </div>
        )}

        {/* Continuous-scroll PDF pages */}
        <div
          ref={mainRef}
          className="flex-1 overflow-auto"
          style={{ background: '#e8e2d8', overflowAnchor: 'none' }}
          onMouseUp={handleTextSelection}
          onContextMenu={handleContextMenu}
          onClick={handleMarkClick}
        >
          <Document
            file={fileUrl}
            onLoadSuccess={handleDocLoad}
            loading={
              <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-500">
                <div className="w-7 h-7 border-2 border-slate-600 border-t-indigo-500 rounded-full animate-spin" />
                <span className="text-sm">加载 PDF 中…</span>
              </div>
            }
          >
            {numPages > 0 &&
              Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
                <div
                  key={pageNum}
                  ref={el => setPageRef(el, pageNum)}
                  data-page={pageNum}
                  className="flex justify-center"
                  style={{
                    ...(pageDims[pageNum] ? { minHeight: pageDims[pageNum].h * scale } : {}),
                    borderBottom: '2px solid rgba(0,0,0,0.12)',
                  }}
                >
                  <div style={{ background: '#fff' }}>
                    <Page
                      key={`${pageNum}-${annKeyByPage[pageNum] ?? ''}`}
                      pageNumber={pageNum}
                      scale={scale}
                      renderTextLayer={true}
                      customTextRenderer={customTextRenderer}
                    />
                  </div>
                </div>
              ))}
          </Document>
          <div className="h-12" />
        </div>
      </div>
    </div>
  );
}
