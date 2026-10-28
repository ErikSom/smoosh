// Physical regressions need more than "all values are finite". Count connected
// occupied grid regions, weighted by particle count, and inspect deformation.
export function diagnoseParticles(particles, cellSize) {
  const occupied = new Map();
  let count = 0, nonFinite = 0, minDet = Infinity, maxDet = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < particles.length; i += 24) {
    if (particles[i + 15] === 0) continue;
    count++;
    if (!particles.subarray(i,i+24).every(Number.isFinite)) { nonFinite++; continue; }
    const x = particles[i], y = particles[i+1], key = `${Math.floor(x)},${Math.floor(y)}`;
    occupied.set(key,(occupied.get(key)??0)+1);
    minX = Math.min(minX,x); maxX = Math.max(maxX,x);
    const det = particles[i+4]*particles[i+7]-particles[i+5]*particles[i+6];
    minDet = Math.min(minDet,det); maxDet = Math.max(maxDet,det);
  }
  const components = [];
  while (occupied.size) {
    const start = occupied.keys().next().value;
    let weight = occupied.get(start); occupied.delete(start);
    const stack = [start];
    while (stack.length) {
      const [x,y] = stack.pop().split(',').map(Number);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const key = `${x+dx},${y+dy}`;
        if (occupied.has(key)) { weight += occupied.get(key); occupied.delete(key); stack.push(key); }
      }
    }
    components.push(weight);
  }
  components.sort((a,b)=>b-a);
  return { count, nonFinite, minDet, maxDet, width: (maxX-minX)*cellSize, componentCount: components.length, largestFraction: count ? (components[0]??0)/count : 0 };
}
