/** Shared, mutable view of the black-hole settings (written by registry settings' onChange). */
export interface BlackholeState {
  lensing: boolean;
  beaming: boolean;
  redshift: boolean;
  disk: boolean;
  /** 'illustrative': bright thin disk; 'realistic': dim optically thin RIAF-like glow. */
  mode: 'illustrative' | 'realistic';
  orbits: boolean;
}

export const defaultState = (): BlackholeState => ({
  lensing: true,
  beaming: true,
  redshift: true,
  disk: true,
  mode: 'illustrative',
  orbits: true,
});
