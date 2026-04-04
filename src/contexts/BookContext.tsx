import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { Book, Annotation, ChatMessage } from '../types';
import * as db from '../services/db';

interface BookState {
  books: Book[];
  currentBook: Book | null;
  annotations: Annotation[];
  chatMessages: ChatMessage[];
  loading: boolean;
}

type BookAction =
  | { type: 'SET_BOOKS'; payload: Book[] }
  | { type: 'SET_CURRENT_BOOK'; payload: Book | null }
  | { type: 'ADD_BOOK'; payload: Book }
  | { type: 'REMOVE_BOOK'; payload: string }
  | { type: 'SET_ANNOTATIONS'; payload: Annotation[] }
  | { type: 'ADD_ANNOTATION'; payload: Annotation }
  | { type: 'REMOVE_ANNOTATION'; payload: string }
  | { type: 'SET_CHAT_MESSAGES'; payload: ChatMessage[] }
  | { type: 'ADD_CHAT_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'UPDATE_PROGRESS'; payload: { id: string; progress: number; currentPage?: number } }
  | { type: 'UPDATE_BOOK'; payload: Book };

function bookReducer(state: BookState, action: BookAction): BookState {
  switch (action.type) {
    case 'SET_BOOKS':
      return { ...state, books: action.payload };
    case 'SET_CURRENT_BOOK':
      return { ...state, currentBook: action.payload };
    case 'ADD_BOOK':
      return { ...state, books: [...state.books, action.payload] };
    case 'REMOVE_BOOK':
      return { ...state, books: state.books.filter(b => b.id !== action.payload) };
    case 'SET_ANNOTATIONS':
      return { ...state, annotations: action.payload };
    case 'ADD_ANNOTATION':
      return { ...state, annotations: [...state.annotations, action.payload] };
    case 'REMOVE_ANNOTATION':
      return { ...state, annotations: state.annotations.filter(a => a.id !== action.payload) };
    case 'SET_CHAT_MESSAGES':
      return { ...state, chatMessages: action.payload };
    case 'ADD_CHAT_MESSAGE':
      return { ...state, chatMessages: [...state.chatMessages, action.payload] };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'UPDATE_BOOK':
      return { ...state, books: state.books.map(b => b.id === action.payload.id ? action.payload : b) };
    case 'UPDATE_PROGRESS':
      return {
        ...state,
        books: state.books.map(b =>
          b.id === action.payload.id
            ? { ...b, progress: action.payload.progress, currentPage: action.payload.currentPage ?? b.currentPage }
            : b
        ),
        currentBook: state.currentBook?.id === action.payload.id
          ? { ...state.currentBook, progress: action.payload.progress, currentPage: action.payload.currentPage ?? state.currentBook.currentPage }
          : state.currentBook,
      };
    default:
      return state;
  }
}

const initialState: BookState = {
  books: [],
  currentBook: null,
  annotations: [],
  chatMessages: [],
  loading: true,
};

const BookContext = createContext<{
  state: BookState;
  dispatch: React.Dispatch<BookAction>;
} | null>(null);

export function BookProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(bookReducer, initialState);

  useEffect(() => {
    db.getBooks().then(books => {
      dispatch({ type: 'SET_BOOKS', payload: books });
      dispatch({ type: 'SET_LOADING', payload: false });
    });
  }, []);

  return (
    <BookContext.Provider value={{ state, dispatch }}>
      {children}
    </BookContext.Provider>
  );
}

export function useBooks() {
  const ctx = useContext(BookContext);
  if (!ctx) throw new Error('useBooks must be used within BookProvider');
  return ctx;
}
