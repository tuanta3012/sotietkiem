import { SavingsBook } from '../types';
import { buildSavingsBookBusinessId } from './dataTranslator';
import { LocalSyncMutationQueue } from './localSyncQueue';

export interface QueuedBookMergeResult {
  books: SavingsBook[];
  conflict?: string;
}

function comparableBook(book: SavingsBook): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(book).filter(([key]) => key !== 'id').sort(([a], [b]) => a.localeCompare(b)))
  );
}

function findBookIndex(books: SavingsBook[], target: SavingsBook): number {
  const targetBusinessId = buildSavingsBookBusinessId(target);
  const businessMatches = books
    .map((book, index) => ({ book, index }))
    .filter(({ book }) => buildSavingsBookBusinessId(book) === targetBusinessId);
  if (businessMatches.length === 1) return businessMatches[0].index;
  if (businessMatches.length > 1) {
    const idMatches = businessMatches.filter(({ book }) => book.id === target.id);
    return idMatches.length === 1 ? idMatches[0].index : -2;
  }

  const idMatches = books
    .map((book, index) => ({ book, index }))
    .filter(({ book }) => book.id === target.id);
  return idMatches.length === 1 ? idMatches[0].index : idMatches.length > 1 ? -2 : -1;
}

export function mergeQueuedBooks(
  remoteBooks: SavingsBook[],
  queue: LocalSyncMutationQueue
): QueuedBookMergeResult {
  const books = [...remoteBooks];

  for (const settledBook of queue.settledBooks || []) {
    const index = findBookIndex(books, settledBook);
    if (index === -2) {
      return {
        books,
        conflict: `Không thể xác định duy nhất sổ ${settledBook.bookCode || settledBook.id} trên Drive để áp dụng tất toán.`,
      };
    }
    if (index >= 0) books.splice(index, 1);
  }

  for (const settledBookCode of queue.settledBookCodes) {
    const normalizedCode = settledBookCode.replace(/\s+/g, '').toUpperCase();
    const matches = books
      .map((book, index) => ({ book, index }))
      .filter(({ book }) => (book.bookCode || '').replace(/\s+/g, '').toUpperCase() === normalizedCode);
    if (matches.length > 1) {
      return {
        books,
        conflict: `Mã sổ ${settledBookCode} xuất hiện nhiều lần trên Drive; cần đồng bộ lại để tránh xóa nhầm sổ.`,
      };
    }
    if (matches.length === 1) books.splice(matches[0].index, 1);
  }

  for (const deletedBook of queue.deletedBooks) {
    const index = findBookIndex(books, deletedBook);
    if (index === -2) {
      return {
        books,
        conflict: `Không thể xác định duy nhất sổ ${deletedBook.bookCode || deletedBook.id} trên Drive để áp dụng xóa.`,
      };
    }
    if (index < 0) continue;
    if (comparableBook(books[index]) !== comparableBook(deletedBook)) {
      return {
        books,
        conflict: `Sổ ${deletedBook.bookCode || deletedBook.id} đã thay đổi trên Drive sau khi xóa ở thiết bị này.`,
      };
    }
    books.splice(index, 1);
  }

  for (const update of queue.updatedBooks) {
    let index = books.findIndex((book) => book.id === update.book.id);
    if (index < 0 || buildSavingsBookBusinessId(books[index]) !== buildSavingsBookBusinessId(update.book)) {
      index = findBookIndex(books, update.baseBook);
    }
    if (index === -2) {
      return {
        books,
        conflict: `Không thể xác định duy nhất sổ ${update.book.bookCode || update.book.id} trên Drive để áp dụng chỉnh sửa.`,
      };
    }
    if (index < 0) {
      return {
        books,
        conflict: `Không tìm thấy sổ ${update.book.bookCode || update.book.id} trên Drive để áp dụng chỉnh sửa.`,
      };
    }

    const remoteBook = books[index];
    if (
      comparableBook(remoteBook) !== comparableBook(update.baseBook) &&
      comparableBook(remoteBook) !== comparableBook(update.book)
    ) {
      return {
        books,
        conflict: `Sổ ${update.book.bookCode || update.book.id} đã được thay đổi trên Drive. Hãy tải lại và kiểm tra trước khi ghi.`,
      };
    }
    books[index] = update.book;
  }

  for (const newBook of queue.newBooks) {
    const index = findBookIndex(books, newBook);
    if (index === -2) {
      return {
        books,
        conflict: `Không thể xác định duy nhất sổ ${newBook.bookCode || newBook.id} trên Drive để áp dụng thay đổi.`,
      };
    }
    if (index >= 0) {
      if (comparableBook(books[index]) !== comparableBook(newBook)) {
        return {
          books,
          conflict: `Sổ ${newBook.bookCode || newBook.id} trùng khóa nhưng khác nội dung. Đã dừng ghi để tránh ghi đè.`,
        };
      }
      continue;
    }
    books.push(newBook);
  }

  return { books };
}
