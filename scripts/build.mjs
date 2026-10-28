import { readdir, readFile, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);

export async function build() {
  const output = new URL('dist/', root);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const name of (await readdir(new URL('src/', root))).sort()) {
    if (/\.(mjs|d\.ts)$/.test(name)) await copyFile(new URL(`src/${name}`, root), new URL(name, output));
  }
  const sources = {};
  for (const name of (await readdir(new URL('shaders/', root))).sort()) {
    if (name.endsWith('.wgsl')) sources[name.slice(0, -5)] = await readFile(new URL(`shaders/${name}`, root), 'utf8');
  }
  const generated = '// Generated from shaders/*.wgsl. Original copyright and license notices are retained in each source.\n';
  await writeFile(new URL('shader-sources.mjs', output), `${generated}export const embeddedShaderSources = ${JSON.stringify(sources)};\n`);
  return { shaders: Object.keys(sources).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await build();
  console.error(`Built Smoosh with ${result.shaders} embedded shaders.`);
}
