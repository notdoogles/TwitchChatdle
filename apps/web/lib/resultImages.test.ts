import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getResultImages } from './resultImages';

let originalCwd: string;
let tmpDir: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatdle-result-images-'));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string) {
  const full = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, '');
}

describe('getResultImages', () => {
  it('returns an empty array when the directory does not exist', () => {
    expect(getResultImages('winners')).toEqual([]);
  });

  it('returns an empty array when the directory is empty', () => {
    fs.mkdirSync(path.join(tmpDir, 'public', 'static', 'winners'), { recursive: true });
    expect(getResultImages('winners')).toEqual([]);
  });

  it('filters to allowed image extensions only', () => {
    writeFile('public/static/winners/a.png');
    writeFile('public/static/winners/b.jpg');
    writeFile('public/static/winners/notes.txt');
    writeFile('public/static/winners/.DS_Store');
    expect(getResultImages('winners')).toEqual(['/static/winners/a.png', '/static/winners/b.jpg']);
  });

  it('supports a mix of common image formats', () => {
    writeFile('public/static/losers/a.png');
    writeFile('public/static/losers/b.jpeg');
    writeFile('public/static/losers/c.gif');
    writeFile('public/static/losers/d.webp');
    writeFile('public/static/losers/e.avif');
    writeFile('public/static/losers/f.svg');
    expect(getResultImages('losers')).toEqual([
      '/static/losers/a.png',
      '/static/losers/b.jpeg',
      '/static/losers/c.gif',
      '/static/losers/d.webp',
      '/static/losers/e.avif',
      '/static/losers/f.svg',
    ]);
  });

  it('returns entries sorted by filename', () => {
    writeFile('public/static/winners/zebra.png');
    writeFile('public/static/winners/apple.png');
    writeFile('public/static/winners/mango.png');
    expect(getResultImages('winners')).toEqual([
      '/static/winners/apple.png',
      '/static/winners/mango.png',
      '/static/winners/zebra.png',
    ]);
  });

  it('keeps winners and losers directories independent', () => {
    writeFile('public/static/winners/only-winner.png');
    expect(getResultImages('winners')).toEqual(['/static/winners/only-winner.png']);
    expect(getResultImages('losers')).toEqual([]);
  });

  it('prefers a tenant-specific image folder when it has images', () => {
    writeFile('public/static/winners/shared.png');
    writeFile('public/static/tenants/streamer1/winners/tenant-only.png');
    expect(getResultImages('winners', 'streamer1')).toEqual(['/static/tenants/streamer1/winners/tenant-only.png']);
  });

  it('falls back to the shared folder when the tenant folder is missing', () => {
    writeFile('public/static/winners/shared.png');
    expect(getResultImages('winners', 'streamer1')).toEqual(['/static/winners/shared.png']);
  });

  it('falls back to the shared folder when the tenant folder is empty', () => {
    fs.mkdirSync(path.join(tmpDir, 'public', 'static', 'tenants', 'streamer1', 'winners'), { recursive: true });
    writeFile('public/static/winners/shared.png');
    expect(getResultImages('winners', 'streamer1')).toEqual(['/static/winners/shared.png']);
  });
});
