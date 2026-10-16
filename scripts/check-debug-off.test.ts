import { describe, expect, it } from 'vitest';
import { findDebugMarkers } from './check-debug-off';

describe('findDebugMarkers (TC-ADR006-05)', () => {
  it('menemukan penanda overlay di JS', () => {
    const files = [{ file: 'index-abc.js', text: 'x({"data-testid":"debug-overlay"})' }];
    expect(findDebugMarkers(files)).toEqual(['index-abc.js']);
  });

  it('lolos bila JS bersih', () => {
    const files = [{ file: 'index-abc.js', text: 'console.log("halo dunia")' }];
    expect(findDebugMarkers(files)).toEqual([]);
  });

  it('dari beberapa file hanya yang kotor yang dilaporkan', () => {
    const files = [
      { file: 'a.js', text: 'bersih' },
      { file: 'b.js', text: 'className:"debug-overlay"' },
      { file: 'c.js', text: 'juga bersih' },
    ];
    expect(findDebugMarkers(files)).toEqual(['b.js']);
  });
});
