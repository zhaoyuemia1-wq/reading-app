export type BookFormat = 'pdf' | 'epub' | 'txt' | 'md';

export interface Book {
  id: string;
  title: string;
  format: BookFormat;
  fileData: ArrayBuffer;
  fileSize: number;
  addedAt: number;
  lastReadAt: number;
  progress: number; // 0-100
  currentPage?: number;
  totalPages?: number;
  currentChapter?: string;
  coverImage?: string; // base64 data URL of first page thumbnail
  category?: string;   // user-assigned category
}

export interface Annotation {
  id: string;
  bookId: string;
  text: string;         // selected text
  note: string;         // user's note or AI annotation
  isAI: boolean;        // AI-generated or manual
  page?: number;
  chapter?: string;
  color: string;
  createdAt: number;
  /** Exact PDF text-layer span strings captured at selection time — used for precise highlighting */
  spans?: string[];
}

export interface ChatMessage {
  id: string;
  bookId: string;
  role: 'user' | 'assistant';
  content: string;
  imagePreview?: string; // data URL for display only
  timestamp: number;
}

export interface BookSummary {
  id: string;
  bookId: string;
  chapter?: string;
  summary: string;
  keyPoints: string[];
  createdAt: number;
}

export interface Note {
  id: string;
  bookId: string;
  bookTitle: string;
  text: string;         // user's note content
  highlightText: string; // selected text that prompted the note
  page?: number;
  tags: string[];
  createdAt: number;
}

export interface JournalEntry {
  id: string;
  title: string;          // optional title / auto-generated from date
  content: string;        // free-form markdown text
  mood?: string;          // emoji mood: '😊' '🤔' '😔' '🔥' '😴'
  bookId?: string;        // optionally linked to a book
  bookTitle?: string;
  page?: number;          // optional page number if reading-linked
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface VideoEntry {
  id: string;              // internal ID
  videoId: string;         // YouTube video ID
  channelId?: string;
  channelName?: string;
  title: string;
  thumbnail?: string;
  publishedAt?: string;    // ISO date string
  transcript?: string;     // full transcript text
  summary?: string;        // AI-generated summary paragraph
  keyPoints?: string[];    // bullet points
  timestamps?: { time: string; text: string }[]; // key moments
  tags?: string[];
  addedAt: number;
  analyzedAt?: number;
  status: 'pending' | 'fetching' | 'analyzing' | 'done' | 'error';
  error?: string;
}

export interface ChapterRecommendation {
  chapter: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ReadingProfile {
  interests: string[];
  readingGoal: string;
  preferredTopics: string[];
}
