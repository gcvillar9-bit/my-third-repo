/// <reference types="vite/client" />

// GLSL is imported as a string: `import src from './chunks/depth.glsl?raw'`.
declare module '*.glsl?raw' {
  const source: string;
  export default source;
}

interface ImportMetaEnv {
  /** Public base path, e.g. '/my-third-repo/'. Prefix every runtime asset URL with it. */
  readonly BASE_URL: string;
}
