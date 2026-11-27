import type { Metadata } from 'next';
import { Chat } from './chat';
import { ConsentGate } from './consent-gate';

export const metadata: Metadata = { title: 'Chat · Hush' };

export default function ChatPage() {
  return (
    <main>
      <h1 className="sr-only">Hush chat</h1>
      <ConsentGate>
        <Chat />
      </ConsentGate>
    </main>
  );
}
