import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: {
    entry: {
      index: './src/index.ts',
      devtoolsFrame: './src/devtools/frame.ts',
    },
  },
  html: {
    template: ({ entryName }) =>
      entryName === 'devtoolsFrame'
        ? './src/devtools-frame.html'
        : './src/index.html',
    title: ({ entryName }) =>
      entryName === 'devtoolsFrame'
        ? 'Mobile Web DevTools'
        : 'Mobile Web DevTools',
  },
});
