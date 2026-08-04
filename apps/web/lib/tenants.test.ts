import { describe, expect, it } from 'vitest';
import { getTenantOverrides, TENANTS } from './tenants';

describe('getTenantOverrides', () => {
  it('returns an empty object for an unrecognized or missing host', () => {
    expect(getTenantOverrides(undefined)).toEqual({});
    expect(getTenantOverrides(null)).toEqual({});
    expect(getTenantOverrides('unknown.example.com')).toEqual({});
  });

  it('normalizes a port and casing before looking up the tenant', () => {
    const originalKeys = Object.keys(TENANTS);
    // Temporarily register a tenant so the lookup has something to match --
    // TENANTS is empty by default in a single-tenant deployment.
    TENANTS['streamer1.example.com'] = { channel: 'streamer1' };
    try {
      expect(getTenantOverrides('Streamer1.Example.com:3000')).toEqual({ channel: 'streamer1' });
    } finally {
      for (const key of Object.keys(TENANTS)) {
        if (!originalKeys.includes(key)) delete TENANTS[key];
      }
    }
  });

  it('returns a databaseUrlEnv override when the tenant keeps its own database', () => {
    const originalKeys = Object.keys(TENANTS);
    TENANTS['streamer2.example.com'] = { channel: 'streamer2', databaseUrlEnv: 'STREAMER2_DATABASE_URL' };
    try {
      expect(getTenantOverrides('streamer2.example.com')).toEqual({
        channel: 'streamer2',
        databaseUrlEnv: 'STREAMER2_DATABASE_URL',
      });
    } finally {
      for (const key of Object.keys(TENANTS)) {
        if (!originalKeys.includes(key)) delete TENANTS[key];
      }
    }
  });
});
