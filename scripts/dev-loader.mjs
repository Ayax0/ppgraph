// Lets `pnpm dev` run the TypeScript sources directly, with no build and no extra dependency.
//
// Node can strip the types by itself, but it cannot resolve the imports: the source says
// `./report.js` (what NodeNext requires, because that is the name after compilation) while the
// file on disk is `./report.ts`. This hook retries such a specifier against its `.ts` sibling and
// otherwise stays out of the way — a bare specifier, a real `.js` file and anything inside
// node_modules all resolve exactly as they normally would.
//
// Development only. Needs Node >= 22.15 (`registerHooks`); the package itself still runs on 18.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.js') && /^\.{1,2}\//.test(specifier)) {
      try {
        return nextResolve(`${specifier.slice(0, -'.js'.length)}.ts`, context);
      } catch {
        // No TypeScript sibling — fall through and let the original specifier report the failure.
      }
    }
    return nextResolve(specifier, context);
  },
});
