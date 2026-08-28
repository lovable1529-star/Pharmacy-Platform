'use client';

/**
 * One dropdown for the whole system, with a search box in it.
 *
 * Native `<select>` makes you scroll. Eleven GP surgeries, six pharmacists, a
 * shelf of vaccine batches and a list of every country are all lists somebody
 * has to hunt through with a mouse wheel — and at a counter with a patient
 * waiting, that is the difference between fast and irritating.
 *
 * The search box appears once a list is long enough to be worth searching. A
 * two-option picker with a filter field above it is chrome, not help; the
 * complaint is scrolling, and a short list never scrolls.
 *
 * Deliberately not a library. This needs to work identically on a counter
 * tablet and a patient's phone, and stay inside the design tokens — and the
 * behaviour that actually matters is keyboard handling, which is a hundred
 * lines rather than a dependency.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  /** Second line — a GP's email, a batch expiry, a pharmacist's GPhC number. */
  hint?: string;
  disabled?: boolean;
}

/** Below this, a search field is noise rather than help. */
const SEARCH_THRESHOLD = 7;

export interface SearchSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Shown as the first option, for "any" or "not recorded". */
  emptyLabel?: string | null;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  emptyLabel = null,
  disabled = false,
  invalid = false,
  className,
  ...aria
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const all = useMemo<SelectOption[]>(
    () => (emptyLabel !== null ? [{ value: '', label: emptyLabel }, ...options] : options),
    [options, emptyLabel],
  );

  const showSearch = all.length >= SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        (o.hint ? o.hint.toLowerCase().includes(needle) : false),
    );
  }, [all, query]);

  const selected = all.find((o) => o.value === value) ?? null;

  // Close on an outside click or Escape. Both, because people reach for both.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const index = Math.max(0, all.findIndex((o) => o.value === value));
    setActive(index);
    // Focus the search where there is one; otherwise the list takes the keys.
    if (showSearch) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, all, value, showSearch]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(filtered.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[active];
      if (option) choose(option);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  const listId = id ? `${id}-listbox` : undefined;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        className={cn(
          'flex w-full items-center gap-2 rounded-[7px] border bg-surface px-3 py-2 text-left text-[14.5px] text-ink transition-colors',
          invalid ? 'border-stop-600' : 'border-line',
          !disabled && 'hover:border-brand-300 focus:border-brand-400 focus:outline-none',
          disabled && 'cursor-not-allowed opacity-55',
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-ink-faint')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={15}
          strokeWidth={2}
          className={cn('shrink-0 text-ink-faint transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-[9px] border border-line bg-surface shadow-pop">
          {showSearch ? (
            <div className="relative border-b border-line-soft">
              <Search
                size={13}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Type to filter…"
                aria-label="Filter the options"
                aria-controls={listId}
                className="w-full bg-transparent py-2 pl-8 pr-8 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  aria-label="Clear the filter"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[4px] p-1 text-ink-faint hover:bg-sunk hover:text-ink"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          ) : null}

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="max-h-[260px] overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-[13.5px] text-ink-faint">
                Nothing matches “{query}”.
              </li>
            ) : (
              filtered.map((option, i) => {
                const isSelected = option.value === value;
                return (
                  <li
                    key={option.value || '__empty'}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(option)}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 px-3 py-2 text-[14px]',
                      i === active && !option.disabled && 'bg-brand-50',
                      option.disabled && 'cursor-not-allowed opacity-45',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate',
                          isSelected ? 'font-medium text-ink' : 'text-ink-soft',
                        )}
                      >
                        {option.label}
                      </span>
                      {option.hint ? (
                        <span className="block truncate text-[12px] text-ink-faint">
                          {option.hint}
                        </span>
                      ) : null}
                    </span>
                    {isSelected ? (
                      <Check size={14} strokeWidth={2.6} className="mt-0.5 shrink-0 text-brand-600" />
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
