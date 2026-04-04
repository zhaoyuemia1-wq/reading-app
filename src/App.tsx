import { useState } from 'react';
import { BookProvider } from './contexts/BookContext';
import Library from './components/Library/Library';
import Reader from './components/Reader/Reader';
import * as db from './services/db';
import type { Book } from './types';

function App() {
  const [currentBook, setCurrentBook] = useState<Book | null>(null);

  // Always load fresh from IndexedDB to ensure ArrayBuffer is not detached
  const handleOpenBook = async (book: Book) => {
    const fresh = await db.getBook(book.id);
    if (fresh) setCurrentBook(fresh);
  };

  return (
    <BookProvider>
      {currentBook ? (
        <Reader book={currentBook} onBack={() => setCurrentBook(null)} />
      ) : (
        <Library onOpenBook={handleOpenBook} />
      )}
    </BookProvider>
  );
}

export default App;
