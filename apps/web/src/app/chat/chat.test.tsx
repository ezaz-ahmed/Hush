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
});
