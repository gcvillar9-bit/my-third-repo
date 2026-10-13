/** Writes generated text files through prettier (repo config) so `prettier --check` stays green. */
import { writeFileSync } from 'node:fs';
import * as prettier from 'prettier';

export async function writeFormatted(path, text) {
  const options = (await prettier.resolveConfig(path)) ?? {};
  writeFileSync(path, await prettier.format(text, { ...options, filepath: path }));
}
