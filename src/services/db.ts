import { openDB, type IDBPDatabase } from 'idb';
import type { Book, Annotation, ChatMessage, BookSummary, Note, JournalEntry, VideoEntry } from '../types';

const DB_NAME = 'readmate-v4';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase | null = null;

async function getDB() {
  if (dbInstance) return dbInstance;
  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('annotations')) {
        const store = db.createObjectStore('annotations', { keyPath: 'id' });
        store.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('chats')) {
        const store = db.createObjectStore('chats', { keyPath: 'id' });
        store.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('summaries')) {
        const store = db.createObjectStore('summaries', { keyPath: 'id' });
        store.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('notes')) {
        const store = db.createObjectStore('notes', { keyPath: 'id' });
        store.createIndex('bookId', 'bookId');
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('journal')) {
        const store = db.createObjectStore('journal', { keyPath: 'id' });
        store.createIndex('bookId', 'bookId');
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('videos')) {
        const store = db.createObjectStore('videos', { keyPath: 'id' });
        store.createIndex('channelId', 'channelId');
        store.createIndex('addedAt', 'addedAt');
        store.createIndex('videoId', 'videoId', { unique: true });
      }
    },
  });
  return dbInstance;
}

// Books
export async function saveBook(book: Book) {
  const db = await getDB();
  await db.put('books', book);
}

export async function getBooks(): Promise<Book[]> {
  const db = await getDB();
  return db.getAll('books');
}

export async function getBook(id: string): Promise<Book | undefined> {
  const db = await getDB();
  return db.get('books', id);
}

export async function deleteBook(id: string) {
  const db = await getDB();
  await db.delete('books', id);
  const annotations = await getAnnotations(id);
  for (const a of annotations) await db.delete('annotations', a.id);
  const chats = await getChatMessages(id);
  for (const c of chats) await db.delete('chats', c.id);
  const summaries = await getSummaries(id);
  for (const s of summaries) await db.delete('summaries', s.id);
}

export async function updateBookCoverImage(id: string, coverImage: string) {
  const db = await getDB();
  const book = await db.get('books', id);
  if (book) {
    book.coverImage = coverImage;
    await db.put('books', book);
  }
}

export async function updateBookProgress(id: string, progress: number, currentPage?: number) {
  const db = await getDB();
  const book = await db.get('books', id);
  if (book) {
    book.progress = progress;
    book.lastReadAt = Date.now();
    if (currentPage !== undefined) book.currentPage = currentPage;
    await db.put('books', book);
  }
}

// Annotations
export async function saveAnnotation(annotation: Annotation) {
  const db = await getDB();
  await db.put('annotations', annotation);
}

export async function getAnnotations(bookId: string): Promise<Annotation[]> {
  const db = await getDB();
  return db.getAllFromIndex('annotations', 'bookId', bookId);
}

export async function deleteAnnotation(id: string) {
  const db = await getDB();
  await db.delete('annotations', id);
}

// Chat Messages
export async function saveChatMessage(msg: ChatMessage) {
  const db = await getDB();
  await db.put('chats', msg);
}

export async function getChatMessages(bookId: string): Promise<ChatMessage[]> {
  const db = await getDB();
  return db.getAllFromIndex('chats', 'bookId', bookId);
}

// Summaries
export async function saveSummary(summary: BookSummary) {
  const db = await getDB();
  await db.put('summaries', summary);
}

export async function getSummaries(bookId: string): Promise<BookSummary[]> {
  const db = await getDB();
  return db.getAllFromIndex('summaries', 'bookId', bookId);
}

// Notes
export async function saveNote(note: Note) {
  const db = await getDB();
  await db.put('notes', note);
}

export async function getNotes(bookId?: string): Promise<Note[]> {
  const db = await getDB();
  if (bookId) {
    return db.getAllFromIndex('notes', 'bookId', bookId);
  }
  return db.getAll('notes');
}

export async function deleteNote(id: string) {
  const db = await getDB();
  await db.delete('notes', id);
}

// Journal
export async function saveJournalEntry(entry: JournalEntry) {
  const db = await getDB();
  await db.put('journal', entry);
}

export async function getJournalEntries(bookId?: string): Promise<JournalEntry[]> {
  const db = await getDB();
  if (bookId) {
    return db.getAllFromIndex('journal', 'bookId', bookId);
  }
  return db.getAll('journal');
}

export async function deleteJournalEntry(id: string) {
  const db = await getDB();
  await db.delete('journal', id);
}

// Videos
export async function saveVideo(video: VideoEntry) {
  const db = await getDB();
  await db.put('videos', video);
}

export async function getVideos(): Promise<VideoEntry[]> {
  const db = await getDB();
  return db.getAll('videos');
}

export async function getVideo(id: string): Promise<VideoEntry | undefined> {
  const db = await getDB();
  return db.get('videos', id);
}

export async function getVideoByYouTubeId(videoId: string): Promise<VideoEntry | undefined> {
  const db = await getDB();
  return db.getFromIndex('videos', 'videoId', videoId);
}

export async function deleteVideo(id: string) {
  const db = await getDB();
  await db.delete('videos', id);
}

export async function getVideosByChannel(channelId: string): Promise<VideoEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex('videos', 'channelId', channelId);
}
