import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenantOverrides, loadTenants } from './tenants';

// Tenant config comes from the TENANTS_JSON env var (or an explicit raw
// string in tests). Seeding via loadTenants() keeps these tests hermetic --
// no env var stubbing needed for the seed itself.

const SEED = {
  'elliebdle.doogl.es': {
    channel: 'elliebwalker',
    gameName: 'Elliebdle',
    imagesSlug: 'elliebdle',
    databaseUrl: 'postgres://ellie',
    twitchClientId: 'tenant-client-id',
    adminSecret: 'tenant-admin-secret',
  },
  'streamer1.example.com': { channel: 'streamer1' },
  'streamer2.example.com': { channel: 'streamer2', databaseUrlEnv: 'STREAMER2_DATABASE_URL' },
};

describe('loadTenants', () => {
  it('parses a valid tenant JSON blob', () => {
    const tenants = loadTenants(JSON.stringify(SEED));
    expect(tenants['elliebdle.doogl.es']).toEqual(SEED['elliebdle.doogl.es']);
    expect(tenants['streamer1.example.com']).toEqual({ channel: 'streamer1' });
  });

  it('treats missing or empty input as an empty map', () => {
    expect(loadTenants()).toEqual({});
    expect(loadTenants('')).toEqual({});
    expect(loadTenants('   ')).toEqual({});
  });

  it('falls back to an empty map on malformed JSON without throwing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(loadTenants('{ not json')).toEqual({});
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('rejects non-object roots', () => {
    expect(loadTenants('[1,2]')).toEqual({});
    expect(loadTenants('null')).toEqual({});
    expect(loadTenants('"hi"')).toEqual({});
  });
});

describe('loadTenants validation warnings', () => {
  // Captures console.warn without letting it pollute the test output.
  function captureWarnings(fn: () => void): string[] {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fn();
      return spy.mock.calls.map((args) => String(args[0]));
    } finally {
      spy.mockRestore();
    }
  }

  it('warns about unknown / misnamed (non-camelCase) fields without dropping them from the map', () => {
    const warnings = captureWarnings(() => {
      const tenants = loadTenants('{"host1.example.com":{"channel":"c1","reset_timezone":"UTC","ad_sidebar_image":"/x.jpg"}}');
      // Unknown keys are ignored by the getters but kept in the raw map.
      expect(tenants['host1.example.com']).toEqual({ channel: 'c1', reset_timezone: 'UTC', ad_sidebar_image: '/x.jpg' });
    });
    expect(warnings.join('\n')).toContain('host1.example.com.reset_timezone');
    expect(warnings.join('\n')).toContain('host1.example.com.ad_sidebar_image');
    expect(warnings.join('\n')).not.toContain('host1.example.com.channel');
  });

  it('warns about type-mismatched fields (e.g. a string where a number is expected)', () => {
    const warnings = captureWarnings(() => {
      loadTenants('{"host1.example.com":{"topChattersLimit":"100","resetHour":"9"}}');
    });
    expect(warnings.join('\n')).toContain('host1.example.com.topChattersLimit');
    expect(warnings.join('\n')).toContain('host1.example.com.resetHour');
  });

  it('warns about and ignores non-object entries instead of crashing later', () => {
    const warnings = captureWarnings(() => {
      const tenants = loadTenants('{"ok.example.com":{"channel":"c1"},"bad.example.com":null,"also-bad.example.com":"string"}');
      expect(tenants['ok.example.com']).toEqual({ channel: 'c1' });
      expect(tenants['bad.example.com']).toBeUndefined();
      expect(tenants['also-bad.example.com']).toBeUndefined();
    });
    expect(warnings.join('\n')).toContain('bad.example.com');
    expect(warnings.join('\n')).toContain('also-bad.example.com');
    // A dropped entry resolves to {} via getTenantOverrides, never throws.
    expect(getTenantOverrides('bad.example.com')).toEqual({});
  });

  it('does not warn for a fully valid config', () => {
    const warnings = captureWarnings(() => {
      loadTenants(JSON.stringify(SEED));
    });
    expect(warnings).toEqual([]);
  });
});

describe('getTenantOverrides', () => {
  beforeEach(() => {
    loadTenants(JSON.stringify(SEED));
  });

  afterEach(() => {
    loadTenants('{}');
  });

  it('returns an empty object for an unrecognized or missing host', () => {
    expect(getTenantOverrides(undefined)).toEqual({});
    expect(getTenantOverrides(null)).toEqual({});
    expect(getTenantOverrides('unknown.example.com')).toEqual({});
  });

  it('normalizes a port and casing before looking up the tenant', () => {
    expect(getTenantOverrides('Streamer1.Example.com:3000')).toEqual({ channel: 'streamer1' });
  });

  it('returns the full override object for a known host', () => {
    expect(getTenantOverrides('elliebdle.doogl.es')).toEqual(SEED['elliebdle.doogl.es']);
  });
});
