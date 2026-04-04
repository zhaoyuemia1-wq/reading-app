import type {} from 'react';
import type { Book } from '../../types';

interface Props {
  book: Book;
  onOpen: (book: Book) => void;
  onDelete: (id: string) => void;
  analyzing?: boolean;
}

const formatBadgeColors: Record<string, { bg: string; text: string }> = {
  pdf:  { bg: 'bg-rose-600/90',    text: 'text-white' },
  epub: { bg: 'bg-emerald-600/90', text: 'text-white' },
  txt:  { bg: 'bg-sky-600/90',     text: 'text-white' },
  md:   { bg: 'bg-violet-600/90',  text: 'text-white' },
};

// Generate a deterministic hue from a string
function titleHue(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

export default function BookCard({ book, onOpen, onDelete, analyzing }: Props) {
  const progressPct = Math.round(book.progress);
  const badge = formatBadgeColors[book.format] ?? formatBadgeColors.txt;
  const hue = titleHue(book.title);
  const firstLetter = book.title.trim()[0]?.toUpperCase() ?? '?';
  const hasCover = !!book.coverImage;

  return (
    <div
      className="group relative cursor-pointer"
      style={{ width: 140, height: 200 }}
      onClick={() => onOpen(book)}
    >
      {/* Card body */}
      <div
        className="relative w-full h-full rounded-lg overflow-hidden shadow-md transition-all duration-200 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-indigo-950/60"
        style={{ transformOrigin: 'bottom center' }}
      >
        {/* Cover image or placeholder */}
        {hasCover ? (
          <img
            src={book.coverImage}
            alt={book.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <PlaceholderCover title={book.title} hue={hue} firstLetter={firstLetter} />
        )}

        {/* Bottom gradient overlay with title */}
        <div
          className="absolute bottom-0 left-0 right-0 px-2 pt-8 pb-1"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)' }}
        >
          <p className="text-white text-xs font-semibold leading-tight line-clamp-2 drop-shadow">
            {book.title}
          </p>
        </div>

        {/* Progress bar at bottom edge */}
        {progressPct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/40">
            <div
              className="h-full"
              style={{
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, #6366f1, #818cf8)',
              }}
            />
          </div>
        )}

        {/* Format badge — top left */}
        <div className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold leading-none ${badge.bg} ${badge.text} shadow`}>
          {book.format.toUpperCase()}
        </div>

        {/* AI analyzing indicator */}
        {analyzing && (
          <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-1 px-2 py-1" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <div className="w-2.5 h-2.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="text-[10px] text-indigo-300 font-medium">AI 分析中</span>
          </div>
        )}

        {/* Delete button — appears on hover, top right */}
        <button
          className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-rose-600 transition-all duration-150"
          onClick={(e) => { e.stopPropagation(); onDelete(book.id); }}
          title="删除"
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function PlaceholderCover({ title, hue, firstLetter }: { title: string; hue: number; firstLetter: string }) {
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center select-none"
      style={{
        background: `linear-gradient(160deg, hsl(${hue},55%,25%) 0%, hsl(${(hue + 40) % 360},50%,18%) 100%)`,
      }}
    >
      {/* Big letter */}
      <span
        className="font-bold leading-none mb-3 drop-shadow-lg"
        style={{
          fontSize: 64,
          color: `hsl(${hue},70%,80%)`,
          textShadow: `0 2px 12px hsl(${hue},60%,10%)`,
        }}
      >
        {firstLetter}
      </span>
      {/* Decorative divider */}
      <div
        className="w-10 h-px mb-2 opacity-40"
        style={{ background: `hsl(${hue},60%,70%)` }}
      />
      {/* Title label */}
      <p
        className="text-center px-3 text-[10px] leading-snug font-medium opacity-70 line-clamp-3"
        style={{ color: `hsl(${hue},60%,85%)` }}
      >
        {title}
      </p>
    </div>
  );
}
