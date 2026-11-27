import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatView, type ChatViewProps } from './chat';
import { initialChatState, type ChatState } from './chat-state';

const noop = () => {};

function render(state: Partial<ChatState> = {}, props: Partial<ChatViewProps> = {}) {
  return renderToStaticMarkup(
    <ChatView
      state={{ ...initialChatState, ...state }}
      input=""
      onInputChange={noop}
      onSubmit={noop}
      onRetry={noop}
      {...props}
    />,
  );
}

const user = { id: 'u1', role: 'user' as const, content: 'hello there' };

describe('ChatView', () => {
  it('renders a labelled textarea, a submit button and a polite log', () => {
    const html = render();

    expect(html).toMatch(/<label[^>]*for="chat-input"[^>]*>/);
    expect(html).toMatch(/<textarea[^>]*id="chat-input"/);
    expect(html).toContain('maxLength="2000"');
    expect(html).toMatch(/<button[^>]*type="submit"/);
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
  });

  it('marks a streaming assistant message busy', () => {
    const html = render({
      status: 'streaming',
      messages: [user, { id: 'a1', role: 'assistant', content: 'partial', state: 'streaming' }],
    });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('partial');
  });

  it('shows a thinking indicator while pending', () => {
    const html = render({
      status: 'sending',
      messages: [user, { id: 'a1', role: 'assistant', content: '', state: 'pending' }],
    });

    expect(html).toContain('Thinking...');
  });

  it('shows the content of a done message, not busy', () => {
    const html = render({
      messages: [user, { id: 'a1', role: 'assistant', content: 'the answer', state: 'done' }],
    });

    expect(html).toContain('hello there');
    expect(html).toContain('the answer');
    expect(html).not.toContain('aria-busy="true"');
  });

  it('shows the error copy and an enabled Retry button', () => {
    const html = render({
      status: 'error',
      messages: [user, { id: 'a1', role: 'assistant', content: 'Oops failed', state: 'error' }],
    });

    expect(html).toContain('Oops failed');
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>Retry<\/button>/);
  });

  it('disables Send and Retry while rate limited', () => {
    const html = render(
      {
        status: 'error',
        retryAfter: 12,
        messages: [
          user,
          { id: 'a1', role: 'assistant', content: 'Try again in 12 seconds.', state: 'error' },
        ],
      },
      { input: 'next question' },
    );

    expect(html).toContain('Try again in 12 seconds.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Retry<\/button>/);
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/,
    );
  });

  it('disables the input while sending', () => {
    const html = render({ status: 'sending' });

    expect(html).toMatch(/<textarea[^>]*disabled=""/);
  });

  it('disables Send when the input is blank', () => {
    expect(render({}, { input: '   ' })).toMatch(
      /<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/,
    );
    expect(render({}, { input: 'hi' })).not.toContain('disabled=""');
  });

  describe('non-answer kinds', () => {
    const cite = [
      {
        id: 'c1',
        chunkId: 'k1',
        documentId: 'd1',
        source: 's',
        title: 'T',
        excerpt: 'e',
        url: null,
      },
    ];
    const done = (kind: 'answer' | 'no_answer' | 'refusal' | 'emergency') =>
      render({
        messages: [
          user,
          {
            id: 'a1',
            role: 'assistant',
            content: 'server text [S1]',
            state: 'done',
            kind,
            citations: cite,
          },
        ],
      });

    it.each(['no_answer', 'refusal'] as const)(
      '%s shows the label and server text, no Sources, Retry, error class or alert',
      (kind) => {
        const html = done(kind);
        expect(html).toContain('Hush can&#x27;t answer this');
        expect(html).toContain('server text [S1]');
        expect(html).not.toContain('Sources');
        expect(html).not.toContain('Retry');
        expect(html).not.toContain('text-red-600');
        expect(html).not.toContain('role="alert"');
      },
    );

    it('emergency shows an alert, heading, server text and a tel link, no Sources', () => {
      const html = done('emergency');
      expect(html).toContain('role="alert"');
      expect(html).toContain('Medical emergency');
      expect(html).toContain('self-stretch');
      expect(html).not.toContain('self-start');
      expect(html).toContain('server text [S1]');
      expect(html).toMatch(/<a[^>]*href="tel:999"[^>]*>Call 999<\/a>/);
      expect(html).not.toContain('Sources');
      expect(html).not.toContain('can&#x27;t answer');
    });

    it('answer shows none of the refusal or emergency markers', () => {
      const html = done('answer');
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain('Medical emergency');
      expect(html).not.toContain('can&#x27;t answer');
      expect(html).not.toContain('tel:');
      expect(html).not.toContain('self-stretch');
    });
  });
});
