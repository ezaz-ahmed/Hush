import { status } from '../lib/status';

export default function HomePage() {
  const { ok, service } = status();
  return (
    <main>
      <h1>Hush</h1>
      <p>
        {service}: {ok ? 'ok' : 'down'}
      </p>
    </main>
  );
}
