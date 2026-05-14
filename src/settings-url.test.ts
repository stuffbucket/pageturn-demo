import { describe, it, expect } from 'vitest';
import { buildSettingsSearch, buildSettingsUrl } from './settings-url';

describe('buildSettingsSearch', () => {
  it('adds requested flags when previously absent', () => {
    const out = buildSettingsSearch('', { debug: true, fiducials: true });
    const p = new URLSearchParams(out.slice(1));
    expect(p.get('debug')).toBe('1');
    expect(p.get('fiducials')).toBe('1');
  });

  it('removes flags that are explicitly disabled', () => {
    const out = buildSettingsSearch('?debug=1&fiducials=1', { debug: false });
    expect(out).toBe('?fiducials=1');
  });

  it('leaves untouched params intact (session, settle, telemetry)', () => {
    const out = buildSettingsSearch(
      '?session=foo&settle=aero&telemetry=1',
      { debug: true },
    );
    const p = new URLSearchParams(out.slice(1));
    expect(p.get('session')).toBe('foo');
    expect(p.get('settle')).toBe('aero');
    expect(p.get('telemetry')).toBe('1');
    expect(p.get('debug')).toBe('1');
  });

  it('maps developable -> dev-surface param name', () => {
    const out = buildSettingsSearch('', { developable: true });
    expect(out).toBe('?dev-surface=1');
  });

  it('returns "" when no params remain', () => {
    expect(buildSettingsSearch('?debug=1', { debug: false })).toBe('');
  });

  it('does not touch flags that are undefined in the input object', () => {
    const out = buildSettingsSearch('?fiducials=1&debug=1', { capture: true });
    const p = new URLSearchParams(out.slice(1));
    expect(p.get('fiducials')).toBe('1');
    expect(p.get('debug')).toBe('1');
    expect(p.get('capture')).toBe('1');
  });

  it('handles a leading "?" or its absence identically', () => {
    expect(buildSettingsSearch('?a=1', { debug: true }))
      .toBe(buildSettingsSearch('a=1', { debug: true }));
  });
});

describe('buildSettingsUrl', () => {
  it('preserves origin, pathname, hash and merges flags into search', () => {
    const url = buildSettingsUrl(
      { origin: 'http://x.test', pathname: '/p/', search: '?session=s', hash: '#bk' },
      { debug: true, fiducials: false },
    );
    expect(url).toBe('http://x.test/p/?session=s&debug=1#bk');
  });
});
