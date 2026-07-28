'use client';

import * as React from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
  }
>(function Button({ className, variant = 'secondary', size = 'md', ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' &&
          'border-transparent bg-[var(--color-moss)] text-white hover:bg-[var(--color-moss-strong)] dark:text-[#0b0f0c]',
        variant === 'secondary' &&
          'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]',
        variant === 'ghost' &&
          'border-transparent bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]',
        variant === 'danger' && 'border-transparent bg-red-600 text-white hover:bg-red-700',
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <LabelPrimitive.Root
        htmlFor={htmlFor}
        className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase"
      >
        {label}
      </LabelPrimitive.Root>
      {children}
      {hint ? <p className="text-xs text-[var(--color-ink-muted)]">{hint}</p> : null}
    </div>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  name,
  ariaLabel,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<Option<T>>;
  name: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <RadioGroup.Root
      className={cn(
        'flex flex-wrap gap-1 rounded-lg bg-[var(--color-surface-muted)] p-1',
        className,
      )}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      aria-label={ariaLabel}
      name={name}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          data-testid={`${name}-${option.value}`}
          title={option.description}
          className={cn(
            'flex-1 cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-[var(--color-ink-muted)]',
            'data-[state=checked]:bg-[var(--color-surface)] data-[state=checked]:text-[var(--color-ink)] data-[state=checked]:shadow-sm',
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  id,
  ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<Option<T>>;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value as T)}
      className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2 text-sm text-[var(--color-ink)]"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <LabelPrimitive.Root htmlFor={id} className="text-sm text-[var(--color-ink)]">
        {label}
      </LabelPrimitive.Root>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        data-testid={`toggle-${id}`}
        className="relative h-5 w-9 shrink-0 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-muted)] transition-colors data-[state=checked]:bg-[var(--color-moss)]"
      >
        <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-4" />
      </SwitchPrimitive.Root>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'positive' | 'caution' | 'critical' | 'info';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]',
        tone === 'positive' &&
          'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
        tone === 'caution' &&
          'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
        tone === 'critical' && 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
        tone === 'info' && 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  children,
  className,
  actions,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-sm',
        className,
      )}
    >
      {title ? (
        <header className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function StatGrid({
  items,
}: {
  items: Array<{ label: string; value: string; hint?: string }>;
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[11px] tracking-wide text-[var(--color-ink-muted)] uppercase">
            {item.label}
          </dt>
          <dd className="text-sm font-semibold text-[var(--color-ink)]" title={item.hint}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 text-sm text-[var(--color-ink-muted)]"
      role="status"
    >
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-moss)]" />
      {label}
    </span>
  );
}
