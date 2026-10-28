import { DEFAULT_SCENE, SCENE_NAMES } from './scenes.mjs';

export function sampleFromURL(url) {
  const params = new URL(url).searchParams;
  const name = params.get('sample') ?? params.get('scene');
  return SCENE_NAMES.includes(name) ? name : DEFAULT_SCENE;
}

export function sampleURL(url, name) {
  const result = new URL(url);
  result.searchParams.delete('scene');
  result.searchParams.set('sample', SCENE_NAMES.includes(name) ? name : DEFAULT_SCENE);
  return result;
}
