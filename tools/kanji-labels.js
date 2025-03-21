import fs from 'fs';
import Papa from 'papaparse';

import { SPARQLQueryDispatcher } from '../utils/SPARQLQueryDispatcher.js';
import { replaceWaseiKanji } from './Wasei-Kanji.js';

const dispatcher = new SPARQLQueryDispatcher();
const queryTemplate = fs.readFileSync('./kanji-labels.rq', 'utf8');

const properties = {
	P11227: 'staff',
	P11736: 'characters',
};
const data = [];
for (const propId in properties) {
	console.log(`Processing ${properties[propId]}...`);
	const sparqlQuery = queryTemplate.replace('<PROPERTY>', propId);
	const response = await dispatcher.query(sparqlQuery);

	for (const { item, jaLabel } of response.results.bindings) {
		const id = item.value.split('/').pop();
		const label = replaceWaseiKanji(jaLabel.value);
		data.push({ id, label });
	}
	data.push([]);
}

const dataFile = `./kanji-labels.tsv`;
if (data.length - 2 > 0) {
	fs.writeFileSync(dataFile, Papa.unparse(data, { delimiter: '\t' }));
} else if (fs.existsSync(dataFile)) {
	fs.unlinkSync(dataFile);
}
