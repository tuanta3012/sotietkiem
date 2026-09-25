import React, { useState, useRef, useEffect, useMemo } from 'react';
import { User, Users, ChevronDown, Check, Tag } from 'lucide-react';
import { SavingsBook } from '../types';
import {
  DEFAULT_OWNER_TAGS,
  getOwnerLabel,
  getOwnerBadgeStyle,
} from '../utils/formatters';

interface OwnerSelectDropdownProps {
  value: string; // 'all' or specific owner tag like 'Chồng', 'Vợ', 'Bố', 'Mẹ'...
  onChange: (ownerTag: string) => void;
  books: SavingsBook[];
  className?: string;
}

export const OwnerSelectDropdown: React.FC<OwnerSelectDropdownProps> = ({
  value,
  onChange,
  books,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Aggregate available owner tags (default + existing books)
  const ownerOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_OWNER_TAGS);
    books.forEach((b) => {
      if (b.owner) {
        set.add(getOwnerLabel(b.owner));
      }
    });
    return Array.from(set);
  }, [books]);

  // Compute counts for each tag
  const ownerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    ownerOptions.forEach((tag) => {
      counts[tag] = books.filter((b) => getOwnerLabel(b.owner) === tag).length;
    });
    return counts;
  }, [ownerOptions, books]);

  const handleSelect = (ownerTag: string) => {
    onChange(ownerTag);
    setIsOpen(false);
  };

  const isAllSelected = value === 'all' || !value;
  const selectedLabel = isAllSelected ? 'Tất cả chủ sổ' : getOwnerLabel(value);
  const selectedBadge = !isAllSelected ? getOwnerBadgeStyle(selectedLabel) : null;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full min-h-[42px] px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 hover:border-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 rounded-xl text-xs font-semibold text-slate-900 transition-all flex items-center justify-between gap-2 shadow-2xs text-left cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          {isAllSelected ? (
            <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Users className="w-3.5 h-3.5" />
            </div>
          ) : (
            <div
              className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 font-bold text-[10px] ${selectedBadge?.bg} ${selectedBadge?.text}`}
            >
              <User className="w-3.5 h-3.5" />
            </div>
          )}

          <div className="truncate">
            <span className="font-bold text-slate-900 block truncate text-xs">
              {selectedLabel}
            </span>
          </div>
        </div>

        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Overlay */}
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-[2px] z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
          />

          <div className="fixed left-3 right-3 bottom-3 sm:bottom-auto sm:left-0 sm:right-auto sm:top-full sm:mt-1.5 sm:w-64 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 p-2 space-y-1 animate-in fade-in zoom-in-95 duration-100 max-h-[70vh] flex flex-col">
            <div className="px-2 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between border-b border-slate-100 mb-1 shrink-0">
              <span>Lọc theo Chủ sổ</span>
              <Tag className="w-3.5 h-3.5 text-slate-400" />
            </div>

            {/* Option: Tất cả chủ sổ */}
            <button
              type="button"
              onClick={() => handleSelect('all')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer shrink-0 ${
                isAllSelected
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 shadow-2xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-emerald-600" />
                <span>Tất cả chủ sổ</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                  {books.length}
                </span>
                {isAllSelected && <Check className="w-3.5 h-3.5 text-emerald-600" />}
              </div>
            </button>

            <div className="h-px bg-slate-100 my-1 shrink-0" />

            {/* List of dynamic owner options */}
            <div className="overflow-y-auto space-y-0.5 flex-1 pr-1">
              {ownerOptions.map((tag) => {
                const isSelected = !isAllSelected && selectedLabel === tag;
                const count = ownerCounts[tag] || 0;
                const badge = getOwnerBadgeStyle(tag);

                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleSelect(tag)}
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 shadow-2xs'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border ${badge.badgeClass}`}
                      >
                        {tag}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                        {count}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
