import type { Metadata } from 'next';
import { Chat } from './chat';

export const metadata: Metadata = { title: 'Chat · Hush' };

export default function ChatPage() {
  return (
    <main>
      <h1 className="sr-only">Hush chat</h1>
      <Chat />
    </main>
  );
}
