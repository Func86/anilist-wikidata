import fs from 'node:fs';

import { CatalogUpdater } from './utils/CatalogUpdater.js';

const catalogName = process.argv[2];
const graphqlQuery = fs.readFileSync(`./catalogs/${catalogName}.graphql`, 'utf8');
const { entryCallback } = await import(`./catalogs/${catalogName}.js`);

const pageOffset = parseInt(process.argv[3]) || 0;
const updater = new CatalogUpdater(catalogName, graphqlQuery, entryCallback, pageOffset);
await updater.update();
