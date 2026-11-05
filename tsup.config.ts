import { defineConfig } from 'tsup';

const env = process.env.NODE_ENV;

export default defineConfig([
  {
    format: ['esm', 'cjs'],
    // The testing entry shares the bootstrap code with the main entry instead of bundling a copy
    splitting: true,
    clean: true,
    dts: true,
    // TODO: For some reason minified code doesn't work for cjs
    minify: false, //env === 'production',
    bundle: true, //env === 'production',
    skipNodeModulesBundle: true,
    watch: env === 'development',
    target: 'esnext',
    outDir: 'dist', //env === 'production' ? 'dist' : 'lib',
    entry: { index: 'src/index.ts', testing: 'src/testing/index.ts' },
    sourcemap: true,
    tsconfig: 'tsconfig.build.json',
    shims: true,
  },
]);
