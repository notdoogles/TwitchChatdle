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
