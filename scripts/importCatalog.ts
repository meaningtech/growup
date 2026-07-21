import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { catalogueStats, loadCatalogue } from '../server/catalog.js';

const switchboardPath = resolve('data/sources/switchboard-4/Switchboard_species.txt');
const globUntPath = resolve('data/sources/globunt-2023/GlobUNT_Species_2023.txt');
const outputPath = resolve('data/generated/catalog-metadata.json');

function md5(path: string): string {
  return createHash('md5').update(readFileSync(path)).digest('hex');
}

const switchboardMd5 = md5(switchboardPath);
const globUntMd5 = md5(globUntPath);

if (switchboardMd5 !== '62029d90d5fece8c423a91bb013441c9') {
  throw new Error(`Unexpected Switchboard MD5: ${switchboardMd5}`);
}

if (globUntMd5 !== '9079961907c125ee937cf52e1fe0ef99') {
  throw new Error(`Unexpected GlobUNT MD5: ${globUntMd5}`);
}

loadCatalogue();
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), hashes: { switchboardMd5, globUntMd5 }, ...catalogueStats() }, null, 2)}\n`,
  'utf8',
);

console.log(`Verified and indexed catalogue metadata at ${outputPath}`);
