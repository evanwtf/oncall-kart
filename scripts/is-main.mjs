// Run a script's main() only when node runs the file itself, not on import.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * true when the module at metaUrl is the script node was started with. Node
 * resolves symlinks for import.meta.url but not for argv[1], so compare real
 * paths: a call through a symlink must still run main().
 * @param {string} metaUrl import.meta.url of the calling module
 * @param {string | undefined} argv1 process.argv[1]
 * @returns {boolean}
 */
export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
