import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node18',
  define: {
    __NIT_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: "// nit — version control for agent cards",
  },
});
