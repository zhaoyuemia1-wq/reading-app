import { openDB, type IDBPDatabase } from 'idb';
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PageEntry {
  page: number;   // 1-indexed book page
  text: string;
}

export interface BookIndex {
  bookId: string;
  title: string;
  totalPages: number;
  pages: PageEntry[];
  createdAt: number;
}

const INDEX_DB_NAME = 'book-index';
const INDEX_DB_VERSION = 1;
let indexDB: IDBPDatabase | null = null;

async function getIndexDB() {
  if (indexDB) return indexDB;
  indexDB = await openDB(INDEX_DB_NAME, INDEX_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('indexes')) {
        db.createObjectStore('indexes', { keyPath: 'bookId' });
      }
    },
  });
  return indexDB;
}

export async function extractPdfText(
  fileData: ArrayBuffer,
  onProgress?: (page: number, total: number) => void
): Promise<PageEntry[]> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(fileData) });
  const pdf = await loadingTask.promise;
  const total = pdf.numPages;
  const pages: PageEntry[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 10) {
      pages.push({ page: i, text });
    }
    onProgress?.(i, total);
  }

  return pages;
}

export async function saveBookIndex(index: BookIndex): Promise<void> {
  const db = await getIndexDB();
  await db.put('indexes', index);
}

export async function getBookIndex(bookId: string): Promise<BookIndex | undefined> {
  const db = await getIndexDB();
  return db.get('indexes', bookId);
}

export async function deleteBookIndex(bookId: string): Promise<void> {
  const db = await getIndexDB();
  await db.delete('indexes', bookId);
}

/** Find which pages are most relevant to a query. Returns top matches. */
export function findRelevantPages(index: BookIndex, query: string, topK = 5): PageEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return [];

  const scored = index.pages.map(p => {
    const lower = p.text.toLowerCase();
    let score = 0;
    for (const word of words) {
      // Count occurrences
      let pos = 0;
      while ((pos = lower.indexOf(word, pos)) !== -1) {
        score++;
        pos++;
      }
    }
    return { ...p, score };
  });

  return scored
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
