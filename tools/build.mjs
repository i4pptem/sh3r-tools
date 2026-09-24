import {build} from 'esbuild';
await build({entryPoints: ['app/ui/renderer.mjs'], outfile: 'app/ui/bundle.js', bundle: true, format: 'esm', target: 'chrome130', minify: true});
console.log('Interface built.');
