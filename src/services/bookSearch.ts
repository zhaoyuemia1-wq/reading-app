export interface BookSearchResult {
  title: string;
  author: string;
  year: number | null;
  coverId: number | null;
  key: string;
  description: string;
}

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  key?: string;
  first_sentence?: { value: string } | string;
}

interface OpenLibraryResponse {
  docs: OpenLibraryDoc[];
}

export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  if (!query.trim()) return [];

  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=8&fields=title,author_name,first_publish_year,cover_i,key,first_sentence`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Open Library search failed: ${response.status}`);
  }

  const data = (await response.json()) as OpenLibraryResponse;

  return (data.docs || []).map(doc => {
    let description = '';
    if (doc.first_sentence) {
      description = typeof doc.first_sentence === 'string'
        ? doc.first_sentence
        : doc.first_sentence.value || '';
    }

    return {
      title: doc.title || 'Unknown Title',
      author: doc.author_name ? doc.author_name[0] : 'Unknown Author',
      year: doc.first_publish_year ?? null,
      coverId: doc.cover_i ?? null,
      key: doc.key || '',
      description,
    };
  });
}

export function getCoverUrl(coverId: number): string {
  return `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
}
