import { SavingsBook } from '../types';
import { normalizeDateToISO } from './dataTranslator';

const normalizeCode = (value: string | undefined): string =>
  (value || '').replace(/\s+/g, '').toUpperCase();

const isGeneratedBookCode = (code: string): boolean =>
  !code || code === 'SO' || code === 'SỔ' || /^SO[-_]?\d+$/i.test(code);

export function getBookIdentityKeys(book: SavingsBook): string[] {
  const bankId = book.bankId.trim().toLowerCase();
  const code = normalizeCode(book.bookCode);
  const keys = [
    `BOOK_${bankId}_${normalizeOwner(book.owner)}_${book.depositType || 'counter'}_${normalizeDateToISO(book.startDate)}`,
    `DETAIL_${bankId}_${normalizeOwner(book.owner)}_${Number(book.principal)}_${normalizeDateToISO(book.startDate)}_${normalizeDateToISO(book.maturityDate)}`,
  ];

  if (!isGeneratedBookCode(code)) {
    keys.unshift(`CODE_${bankId}_${code}`);
  }
  return [...new Set(keys)];
}

export function getPrimaryBookIdentityKey(book: SavingsBook): string {
  return getBookIdentityKeys(book)[0];
}

function normalizeOwner(owner: string): string {
  return owner.trim().toLowerCase().replace(/\s+/g, ' ');
}
