import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

function nearestExistingRealPath(path: string): string {
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return realpathSync(current);
}

/**
 * True when `path` would land inside a git working tree (any ancestor holds `.git`) or inside
 * `extraRoot` (the project directory). Used to keep private keys out of repositories.
 */
export function isInsideWorkTree(path: string, extraRoot?: string): boolean {
  const target = nearestExistingRealPath(dirname(resolve(path)));
  if (extraRoot !== undefined) {
    const root = nearestExistingRealPath(extraRoot);
    if (target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)) return true;
  }
  for (let dir = target; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return true;
    if (dirname(dir) === dir) return false;
  }
}
