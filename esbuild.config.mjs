import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: {
    background: 'src/background/background.ts',
    content: 'src/content/content.tsx',
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome110',
  jsx: 'automatic',
  sourcemap: true,
  logLevel: 'info',
  // Dev-gated logging: verbose in watch mode, silent in production builds.
  define: { __DEV__: JSON.stringify(watch) },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(options);
}
