'use client';

import clsx from 'clsx';
import { ApiError } from '@/lib/api';

interface ErrorStateProps {
  error: Error | null;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  error,
  title = 'Ein Fehler ist aufgetreten',
  onRetry,
  className,
}: ErrorStateProps) {
  const message = getErrorMessage(error);
  const isRetryable = isRetryableError(error);

  return (
    <div
      className={clsx(
        'flex min-h-[300px] flex-col items-center justify-center gap-4 text-center',
        className
      )}
      role="alert"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertIcon className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && isRetryable && (
        <button
          onClick={onRetry}
          className={clsx(
            'rounded-md border px-4 py-2 text-sm font-medium',
            'hover:bg-accent',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          )}
        >
          Erneut versuchen
        </button>
      )}
    </div>
  );
}

interface ErrorBannerProps {
  error: Error | null;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorBanner({ error, onDismiss, className }: ErrorBannerProps) {
  if (!error) return null;

  const message = getErrorMessage(error);

  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3',
        className
      )}
      role="alert"
    >
      <AlertIcon className="h-5 w-5 flex-shrink-0 text-destructive" />
      <p className="flex-1 text-sm">{message}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Schliessen"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function getErrorMessage(error: Error | null): string {
  if (!error) return 'Unbekannter Fehler';

  if (error instanceof ApiError) {
    return error.userMessage;
  }

  if (error.message === 'Failed to fetch') {
    return 'Verbindung zum Server fehlgeschlagen. Pruefe deine Internetverbindung.';
  }

  return error.message || 'Ein unerwarteter Fehler ist aufgetreten.';
}

function isRetryableError(error: Error | null): boolean {
  if (!error) return false;

  if (error instanceof ApiError) {
    return error.isThrottled || error.status >= 500;
  }

  return error.message === 'Failed to fetch';
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
