import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const pdf = process.argv[2] ?? '.pi/fuck_you/Fuck-You-No Game Cards.pdf';
const source = fs.readFileSync('client/fuck_you/js/cards.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText;
const { CARDS } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuck-you-'));
const output = 'client/fuck_you/images/cards';
fs.mkdirSync(output, { recursive: true });
try {
    for (const page of new Set([2, ...CARDS.map(card => card.source.page)])) {
        const file = path.join(temp, `page-${page}`);
        execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-scale-to', '1800', '-png', '-singlefile', pdf, file]);
        const cards = page === 2 ? [{ id: 'back', source: { cell: 0 } }] : CARDS.filter(card => card.source.page === page);
        for (const card of cards) {
            const col = card.source.cell % 3;
            const row = Math.floor(card.source.cell / 3);
            execFileSync('magick', [`${file}.png`, '-crop', `308x524+${143 + col * 339}+${81 + row * 558}`, '+repage', path.join(output, `${card.id}.png`)]);
        }
    }
    console.log(`Extracted ${CARDS.length} unique faces and one shared back (${CARDS.reduce((sum, card) => sum + card.copies, 0)} playing cards).`);
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}
