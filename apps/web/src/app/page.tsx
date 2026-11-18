import { status } from '../lib/status';

export default function HomePage() {
  const { ok, service } = status();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-2xl font-semibold">Hush</h1>
      <p className="text-sm text-neutral-500">
        {service}: {ok ? 'ok' : 'down'}
      </p>
    </main>
  );
}
