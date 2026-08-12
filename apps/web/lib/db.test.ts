import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub pg so getPool builds cheap no-op pools whose configs we can
// identity-check without any real connection attempt.
vi.mock('pg', () => {
  class MockPool {
    constructor(public config: Record<string, unknown>) {}
  }
  return { Pool: MockPool };
});

import { getPool } from './db';
import { loadTenants } from './tenants';

const TENANT_HOST = 'tenant.example.com';

// The vi.mock above is runtime-only, so tsc still sees getPool's real return
// type (pg's Pool). Cast just far enough to inspect the mocked config.
type MockPool = { config: { connectionString?: string } };
function poolConfig(pool: ReturnType<typeof getPool>): MockPool['config'] {
  return (pool as unknown as MockPool).config;
}

// Seeds the tenant map (normally loaded from the TENANTS_JSON env var).
function seedTenants(overrides: Record<string, unknown>) {
  loadTenants(JSON.stringify(overrides));
}

describe('getPool', () => {
  const originalDbUrl = process.env.DATABASE_URL;
  const originalTenantUrl = process.env.TENANT_DB_URL;

  beforeEach(() => {
    delete (global as { pgPools?: unknown }).pgPools;
  });

  afterEach(() => {
    loadTenants('{}');
    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;
    if (originalTenantUrl === undefined) delete process.env.TENANT_DB_URL;
    else process.env.TENANT_DB_URL = originalTenantUrl;
  });

  it('uses the shared DATABASE_URL for hosts without a tenant override', () => {
    process.env.DATABASE_URL = 'postgres://shared';
    const shared = getPool();
    expect(poolConfig(shared).connectionString).toBe('postgres://shared');
    expect(getPool(undefined)).toBe(shared);
    expect(getPool('whisqeydle.doogl.es')).toBe(shared);
  });

  it('routes a tenant with a databaseUrlEnv override to its own connection string', () => {
    seedTenants({ [TENANT_HOST]: { channel: 'tenant', databaseUrlEnv: 'TENANT_DB_URL' } });
    process.env.DATABASE_URL = 'postgres://shared';
    process.env.TENANT_DB_URL = 'postgres://ellie';

    const tenantPool = getPool(TENANT_HOST);
    expect(poolConfig(tenantPool).connectionString).toBe('postgres://ellie');
    expect(tenantPool).not.toBe(getPool());
  });

  it('routes a tenant with an embedded databaseUrl to its own connection string', () => {
    seedTenants({ [TENANT_HOST]: { channel: 'tenant', databaseUrl: 'postgres://embedded' } });
    process.env.DATABASE_URL = 'postgres://shared';

    const tenantPool = getPool(TENANT_HOST);
    expect(poolConfig(tenantPool).connectionString).toBe('postgres://embedded');
    expect(tenantPool).not.toBe(getPool());
  });

  it('prefers an embedded databaseUrl over a legacy databaseUrlEnv', () => {
    seedTenants({
      [TENANT_HOST]: { channel: 'tenant', databaseUrl: 'postgres://embedded', databaseUrlEnv: 'TENANT_DB_URL' },
    });
    process.env.TENANT_DB_URL = 'postgres://env-name';

    expect(poolConfig(getPool(TENANT_HOST)).connectionString).toBe('postgres://embedded');
  });

  it('caches one pool per connection string', () => {
    seedTenants({ [TENANT_HOST]: { channel: 'tenant', databaseUrlEnv: 'TENANT_DB_URL' } });
    process.env.TENANT_DB_URL = 'postgres://ellie';
    expect(getPool(TENANT_HOST)).toBe(getPool(TENANT_HOST));
    expect(getPool()).toBe(getPool());
    expect(getPool(TENANT_HOST)).not.toBe(getPool());
  });

  it('normalizes host port/casing before resolving the tenant', () => {
    seedTenants({ [TENANT_HOST]: { channel: 'tenant', databaseUrlEnv: 'TENANT_DB_URL' } });
    process.env.TENANT_DB_URL = 'postgres://ellie';
    expect(getPool('Tenant.Example.com:3000')).toBe(getPool(TENANT_HOST));
  });

  it('falls back to DATABASE_URL when the tenant env var is unset', () => {
    seedTenants({ [TENANT_HOST]: { channel: 'tenant', databaseUrlEnv: 'TENANT_DB_URL' } });
    process.env.DATABASE_URL = 'postgres://shared';
    // TENANT_DB_URL deliberately not set.
    expect(poolConfig(getPool(TENANT_HOST)).connectionString).toBe('postgres://shared');
  });
});
