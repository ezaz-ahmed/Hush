'use client';

import { PRIVACY_NOTICE_VERSION } from '@hush/shared';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getConsent, grantConsent, type ConsentResult } from '../../lib/consent-client';

export type ConsentScreenProps = { onAgree: () => void; pending?: boolean; error?: boolean };

export function ConsentScreen({ onAgree, pending = false, error = false }: ConsentScreenProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 p-4">
      <h2 className="text-lg font-medium">Before you chat</h2>
      <p className="text-sm">
        Hush answers general questions from our knowledge base. We process what you type to answer
        you, and we store your messages. This is not medical advice. You can delete your data later.
        Please read the{' '}
        <Link href="/privacy" className="underline">
          privacy notice
        </Link>{' '}
        <span className="text-neutral-500">(Privacy notice {PRIVACY_NOTICE_VERSION})</span> and
        agree to continue.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          We couldn&apos;t save your consent. Please try again.
        </p>
      )}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onAgree}
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          I agree
        </button>
        <Link href="/" className="text-sm underline">
          Not now
        </Link>
      </div>
    </div>
  );
}

const isCurrent = (r: ConsentResult) => r.ok && r.record.noticeVersion === PRIVACY_NOTICE_VERSION;

/** Fail closed: children render only after a record for the current notice version. */
export function ConsentGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'needed' | 'granted'>('checking');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void getConsent(c.signal).then((r) => {
      if (!c.signal.aborted) setStatus(isCurrent(r) ? 'granted' : 'needed');
    });
    return () => c.abort();
  }, []);

  const agree = async () => {
    const signal = controller.current?.signal;
    if (pending || !signal) return;
    setPending(true);
    setError(false);
    const r = await grantConsent(signal);
    if (signal.aborted) return;
    setPending(false);
    if (isCurrent(r)) setStatus('granted');
    else setError(true);
  };

  if (status === 'granted') return children;
  if (status === 'checking') return <p className="p-4 text-sm">Loading...</p>;
  return <ConsentScreen onAgree={() => void agree()} pending={pending} error={error} />;
}
