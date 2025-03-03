import fs from 'node:fs';

import { CatalogUpdater } from './utils/CatalogUpdater.js';

const catalogName = process.argv[2];
const graphqlQuery = fs.readFileSync(`./catalogs/${catalogName}.graphql`, 'utf8');
const { entryCallback } = await import(`./catalogs/${catalogName}.js`);

const updateType = process.argv[3] || 'incremental';
const pageOffset = parseInt(process.argv[4]) || 0;
const updater = new CatalogUpdater(catalogName, graphqlQuery, entryCallback);
await updater.update(updateType, pageOffset);
