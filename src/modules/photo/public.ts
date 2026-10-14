/**
 * Cross-module API of the photo module (P5-B). The UI shell's Photo button and the tours module
 * use `photo`; the module provides the implementation during init.
 */
export const PHOTO_MODULE_ID = 'photo';
/** Attribute set on <html> while photo mode is on; UI and overlays hide themselves with CSS. */
export const PHOTO_ATTR = 'data-photo';

export interface PhotoControl {
  readonly active: boolean;
  toggle(): void;
  enter(): void;
  exit(): void;
  /** Renders the next frame into a PNG (with the credits line). Null when capture failed. */
  save(): Promise<Blob | null>;
}

let impl: PhotoControl | null = null;

export function providePhoto(c: PhotoControl | null): void {
  impl = c;
}

export const photo: PhotoControl = {
  get active() {
    return impl?.active ?? false;
  },
  toggle: () => impl?.toggle(),
  enter: () => impl?.enter(),
  exit: () => impl?.exit(),
  save: () => impl?.save() ?? Promise.resolve(null),
};
