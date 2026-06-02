import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

content = content.replace(/\{\(\+\{playerScore\.earned\} MELDS, -\{playerScore\.penalty\} HAND\)\}/g, '');
content = content.replace(/\{\(\+\{cpuScore\.earned\} MELDS, -\{cpuScore\.penalty\} HAND\)\}/g, '');

fs.writeFileSync('src/App.tsx', content);
