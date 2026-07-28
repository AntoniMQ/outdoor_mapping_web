import Link from 'next/link';
import { Compass } from 'lucide-react';
import { BRAND } from '@/lib/env/client';
import { ThemeToggle } from '@/components/layout/theme-toggle';

export function SiteHeader() {
  return (
    <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Compass aria-hidden size={20} className="text-[var(--color-moss)]" />
          <span>{BRAND.name}</span>
          <span className="hidden text-xs font-normal text-[var(--color-ink-muted)] sm:inline">
            {BRAND.tagline}
          </span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link
            className="rounded-md px-2.5 py-1.5 hover:bg-[var(--color-surface-muted)]"
            href="/planner"
          >
            Planner
          </Link>
          <Link
            className="rounded-md px-2.5 py-1.5 hover:bg-[var(--color-surface-muted)]"
            href="/about/data"
          >
            Data
          </Link>
          <Link
            className="rounded-md px-2.5 py-1.5 hover:bg-[var(--color-surface-muted)]"
            href="/privacy"
          >
            Privacy
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
