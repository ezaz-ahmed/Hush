import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ChatPage from './page';

describe('ChatPage', () => {
  it('does not render the chat input before consent is checked', () => {
    const html = renderToStaticMarkup(<ChatPage />);
    expect(html).toContain('Hush chat');
    expect(html).not.toContain('<textarea');
  });
});
