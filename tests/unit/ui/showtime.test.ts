import { describe, expect, it } from 'vitest';
import type { Bookmark } from '../../../src/core/contracts';
import { LINE_BOOKMARKS } from '../../../src/modules/starsystems/public';
import { TOUR_ENTRY_PREFIX, tours } from '../../../src/modules/tours/public';
import { HELP_TEXT } from '../../../src/ui/app';
import { wantsLines } from '../../../src/ui/controller';

describe('showtime UI hooks', () => {
  it('constellation bookmarks switch the lines on however they are flown to', () => {
    expect(LINE_BOOKMARKS).toContain('orion-lines-from-earth');
    expect(wantsLines('orion-lines-from-earth')).toBe(true);
    const bm = { id: 'big-dipper-100kyr', title: 'x', frame: 'ssb', pos: { x: 0, y: 0, z: 0 } } as Bookmark;
    expect(wantsLines(bm)).toBe(true);
    expect(wantsLines('earth-now')).toBe(false);
    expect(wantsLines('orion-from-earth')).toBe(false);
  });

  it('tour control is a safe no-op before the tours module provides it', () => {
    expect(tours.start('cosmic-zoom')).toBe(false);
    expect(tours.status()).toBeNull();
    expect(() => tours.stop()).not.toThrow();
    expect(TOUR_ENTRY_PREFIX).toBe('tour:');
  });

  it('help text documents photo mode, the K pause and Esc', () => {
    expect(HELP_TEXT).toContain('P photo mode');
    expect(HELP_TEXT).toContain('K pause');
    expect(HELP_TEXT).not.toContain('P pause');
  });
});
