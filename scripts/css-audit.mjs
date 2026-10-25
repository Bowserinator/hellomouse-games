// Reports SCSS class selectors that no client file uses and SCSS variables that nothing reads.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const scssDir = process.argv[2] ?? 'scss/unstable_unicorns/css';
const clientDir = process.argv[3] ?? 'client/unstable_unicorns';

function walk(dir, extension, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, extension, out);
        else if (path.endsWith(extension)) out.push(path);
    }
    return out;
}

function exists(path) {
    try {
        statSync(path);
        return true;
    } catch {
        return false;
    }
}

const scssFiles = walk(scssDir, '.scss');
const scss = scssFiles.map(file => readFileSync(file, 'utf8')).join('\n');
const clientFiles = walk(clientDir, '.ts').concat(walk(clientDir, '.html'));
const client = clientFiles.map(file => readFileSync(file, 'utf8')).join('\n');

const classes = new Set();
for (const match of scss.matchAll(/\.([a-zA-Z][\w-]*)/g)) classes.add(match[1]);
const deadClasses = [...classes].filter(name => !client.includes(name)).sort();

const declared = new Set();
for (const match of scss.matchAll(/^\$([\w-]+):/gm)) declared.add(match[1]);
const deadVars = [...declared].filter(name => {
    const uses = scss.match(new RegExp(`\\$${name}\\b`, 'g')) ?? [];
    return uses.length <= 1;
}).sort();

console.log(`Checked ${scssFiles.length} SCSS files against ${clientFiles.length} client files.`);
console.log(deadClasses.length === 0 ? 'No dead class selectors.' : `Dead class selectors: ${deadClasses.join(' ')}`);
console.log(deadVars.length === 0 ? 'No dead variables.' : `Dead variables: ${deadVars.join(' ')}`);

if (deadClasses.length > 0 || deadVars.length > 0) process.exitCode = 1;
