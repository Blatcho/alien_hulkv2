// Node test setup: resolve the browser import-map specifiers ('three', 'three/addons/...') to the
// vendored files so the game modules load under node.  Used via `node --import ./tests/_resolve.mjs`.
import { register } from 'node:module';
register('./_three-hook.mjs', import.meta.url);
