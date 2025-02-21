import fs from 'node:fs';

import { SPARQLQueryDispatcher } from '../utils/SPARQLQueryDispatcher.js';
import { replaceWaseiKanji } from './Wasei-Kanji.js';

const dispatcher = new SPARQLQueryDispatcher();
const queryTemplate = fs.readFileSync('./kanji-labels.rq', 'utf8');

const properties = {
	'P11227': 'staff',
	'P11736': 'character',
};
for (const propId in properties) {
	const sparqlQuery = queryTemplate.replace('<PROPERTY>', propId);
	const response = await dispatcher.query(sparqlQuery);

	const data = [];
	for (const { item, jaLabel } of response.results.bindings) {
		const id = item.value.split('/').pop();
		const label = replaceWaseiKanji(jaLabel.value);
		data.push([ id, 'Lzh', `"${label}"` ]);
	}

	const dataFile = `./kanji-labels-${properties[propId]}.tsv`;
	if (data.length) {
		fs.writeFileSync(dataFile, data.map((row) => row.join('\t')).join('\n') );
	} else if (fs.existsSync(dataFile)) {
		fs.unlinkSync(dataFile);
	}
}
