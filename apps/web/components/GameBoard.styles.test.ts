import fs from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

// These are visual regressions that don't surface in jsdom (which has no
// real layout/paint): a suggestions dropdown that's see-through, or a page
// whose bottom is cut off behind mobile browser chrome. We can't assert
// computed pixels without a real browser, so instead we pin the specific
// CSS declarations that fix each bug, so a future refactor can't silently
// drop them.

function readCss(relativeToThisFile: string): string {
  return fs.readFileSync(fileURLToPath(new URL(relativeToThisFile, import.meta.url)), 'utf8');
}

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`.${selector}`);
  expect(start, `expected a .${selector} rule in the stylesheet`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('GameBoard suggestions dropdown stays readable', () => {
  const css = readCss('./GameBoard.module.css');

  it('gives the suggestions menu an opaque background so chat behind it never bleeds through', () => {
    const body = ruleBody(css, 'suggestions');
    // An opaque theme surface, not `transparent` or an rgba(...) with alpha.
    expect(body).toMatch(/background:\s*var\(--surface\)\s*;/);
    expect(body).not.toMatch(/background:\s*transparent/);
  });

  it('sits above the chat log rather than behind it', () => {
    const body = ruleBody(css, 'suggestions');
    expect(body).toMatch(/z-index:\s*\d+/);
    expect(body).toMatch(/position:\s*absolute/);
  });

  it('caps its own height and scrolls so a long list cannot run off screen', () => {
    const body = ruleBody(css, 'suggestions');
    expect(body).toMatch(/max-height:/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });
});

describe('layout is not cut off on mobile', () => {
  const globals = readCss('../app/globals.css');

  it('sizes the body to the dynamic viewport height, not the static 100vh', () => {
    expect(globals).toMatch(/height:\s*100dvh/);
  });
});

describe('variable-length messages wrap instead of overflowing', () => {
  const css = readCss('./GameBoard.module.css');

  it('breaks long/unbreakable message text so it cannot overflow the panel width', () => {
    const body = ruleBody(css, 'message');
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('caps the chat log height and scrolls it so the guess box stays reachable', () => {
    const body = ruleBody(css, 'chatLog');
    expect(body).toMatch(/max-height:/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });
});

describe('variably-sized win/loss images stay contained', () => {
  const css = readCss('./GameBoard.module.css');

  it('caps both axes and preserves aspect ratio for any image dimensions', () => {
    const body = ruleBody(css, 'resultImage');
    // Both a width and a height cap, so neither a wide nor a tall image can
    // overflow the panel or dominate it vertically.
    expect(body).toMatch(/max-width:/);
    expect(body).toMatch(/max-height:/);
    expect(body).toMatch(/object-fit:\s*contain/);
  });

  it('does not force-stretch a small image to full width', () => {
    const body = ruleBody(css, 'resultImage');
    expect(body).toMatch(/(^|[^-])width:\s*auto/m);
  });
});
