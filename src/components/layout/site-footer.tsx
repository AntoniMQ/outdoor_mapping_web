import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-6 text-xs text-[var(--color-ink-muted)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Map data ©{' '}
          <a
            className="underline"
            href="https://www.openstreetmap.org/copyright"
            rel="noreferrer noopener"
            target="_blank"
          >
            OpenStreetMap contributors
          </a>
          , available under the Open Database Licence.
        </p>
        <p>
          Mapped access information is not legally authoritative.{' '}
          <Link className="underline" href="/about/data">
            How TrailLoop classifies rights of way
          </Link>
          .
        </p>
      </div>
    </footer>
  );
}
