import { describe, expect, it } from 'vitest';
import { PREVIEW_TENANT_HEADER, resolveHost } from './previewTenant';

describe('resolveHost', () => {
  it('falls back to the host header when no preview override is set', () => {
    const headers = new Headers({ host: 'whisqeydle.doogl.es' });
    expect(resolveHost(headers)).toBe('whisqeydle.doogl.es');
  });

  it('prefers the preview tenant header over host when both are present', () => {
    const headers = new Headers({
      host: 'my-preview-abc123.vercel.app',
      [PREVIEW_TENANT_HEADER]: 'whisqeydle.doogl.es',
    });
    expect(resolveHost(headers)).toBe('whisqeydle.doogl.es');
  });

  it('returns null when neither header is present', () => {
    expect(resolveHost(new Headers())).toBeNull();
  });
});
