import fs from 'node:fs';

import { SPARQLQueryDispatcher } from '../utils/SPARQLQueryDispatcher.js';
import waseiKanji from './Wasei-Kanji.json' with { type: 'json' };

const dispatcher = new SPARQLQueryDispatcher();
const queryTemplate = fs.readFileSync('./kanji-labels.rq', 'utf8');

const properties = {
	'P11736': 'character',
	'P11227': 'staff',
};
for (const propId in properties) {
	const sparqlQuery = queryTemplate.replace('<PROPERTY>', propId);
	const response = await dispatcher.query(sparqlQuery);

	const data = [];
	for (const { item, jaLabel } of response.results.bindings) {
		const id = item.value.split('/').pop();
		const label = replaceBulk(jaLabel.value, waseiKanji);
		data.push([ id, 'Lzh', `"${label}"` ]);
	}

	if (data.length) {
		fs.writeFileSync(
			`./kanji-labels-${properties[propId]}.tsv`,
			data.map((row) => row.join('\t')).join('\n')
		);
	}
}

/**
 * Replaces multiple substrings in a given string based on a replacement map.
 *
 * @param {string} str - The original string where replacements will be made.
 * @param {Object} replaceMap - An object where keys are substrings to be replaced and values are their replacements.
 * @returns {string} - The modified string with all replacements made.
 */
function replaceBulk(str, replaceMap) {
	const regex = Object.keys(replaceMap).map(
		// Escape special characters for regex
		(key) => key.replace(/([-[\]{}()*+?.\\^$|#,])/g, '\\$1')
	);
	return str.replace(new RegExp(regex.join('|'), 'g'), matched => replaceMap[matched]);
}
