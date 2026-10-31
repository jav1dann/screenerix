/**
 * Preload for the test scripts (`tsx --tsconfig tsconfig.json --require ./scripts/server-env.cjs …`): they run server
 * modules outside Next.js, so `import 'server-only'` resolves to the package's empty module, as
 * it does on the Next.js server. Nothing else changes (React keeps its normal build, which the
 * scripts that also load UI modules need).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload: it patches the CJS resolver before tsx loads anything */
const Module = require('node:module');
const path = require('node:path');

const empty = path.join(path.dirname(require.resolve('server-only')), 'empty.js');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'server-only' ? empty : resolve.call(this, request, ...rest);
};
