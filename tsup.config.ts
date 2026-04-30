import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

export default defineConfig(async () => {
  const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

  // Fetch total npm downloads at build time — baked into the binary
  let installCount = 0;
  try {
    const res = await fetch(
      'https://api.npmjs.org/downloads/point/2024-01-01:2099-12-31/@newtype-ai/nit',
    );
    const data = (await res.json()) as { downloads?: number };
    installCount = data.downloads || 0;
  } catch {
    // Offline build — count stays 0
  }

  return {
    entry: {
      index: 'src/index.ts',
      cli: 'src/cli.ts',
      'update-check': 'src/update-check.ts',
    },
    format: ['esm'],
    dts: true,
    clean: true,
    target: 'node18',
    define: {
      __NIT_VERSION__: JSON.stringify(pkg.version),
      __NIT_INSTALL_COUNT__: String(installCount),
    },
    banner: {
      js: '// nit — version control for agent cards',
    },
  };
});
