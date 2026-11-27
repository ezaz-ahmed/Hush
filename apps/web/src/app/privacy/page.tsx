import { PRIVACY_NOTICE_VERSION } from '@hush/shared';
import type { Metadata } from 'next';
import { NoticeBody } from './notice-body';

export const metadata: Metadata = { title: 'Privacy notice · Hush' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6 text-sm">
      <h1 className="text-2xl font-semibold">Privacy notice</h1>
      <p className="text-neutral-500">Version {PRIVACY_NOTICE_VERSION}</p>
      <NoticeBody />
    </main>
  );
}
