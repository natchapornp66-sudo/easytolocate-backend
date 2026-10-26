const fs = require('fs');
const path = require('path');
const source = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'Pjeasy_to_locate', 'dist'));
const root = path.resolve(__dirname, '..');
const destination = path.resolve(root, 'public-app');
if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error('Frontend build not found; run npm run build in the frontend first, then pass the dist directory.');
if (source === destination || source.startsWith(destination + path.sep) || destination.startsWith(source + path.sep)) throw new Error('Source must be outside public-app and must not contain it');
if (path.dirname(destination) !== root || path.basename(destination) !== 'public-app') throw new Error('Invalid generated artifact directory');
// Only replaces this generated artifact directory. Never touches source, .env or uploaded files.
fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
console.log('Production frontend copied to public-app. No server started and nothing published.');
