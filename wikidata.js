import fs from 'node:fs';
import core from '@actions/core';
import { diff } from 'deep-object-diff';

import wikidata from './wikidata.json' with { type: 'json' };
import { SPARQLQueryDispatcher } from './utils/SPARQLQueryDispatcher.js';
import { NodeAwaiter } from './utils/awaiters.js';
import { ChineseConversionManager, ChineseConversionProvider } from './utils/ChineseConversionManager.js';
import { normalizeTitle, buildFullMapFromFallbacks } from './utils/lang-helpers.js';

const sparqlQueries = {
	anime: fs.readFileSync('./wikidata-anime.rq', 'utf8'),
	others: fs.readFileSync('./wikidata-others.rq', 'utf8'),
};
const queryDispatcher = new SPARQLQueryDispatcher();

const data = {
	media: {},
	staff: {},
	character: {},
}, dataSource = {}, isAnimeMap = {};

for (const [ name, sparqlQuery ] of Object.entries(sparqlQueries)) {
	console.log(`Querying data for ${name}...`);
	const startTime = performance.now();
	const response = await queryDispatcher.query(sparqlQuery);
	console.log(`Done in ${Math.round(performance.now() - startTime)} ms`);

	for (const { id, type, source, lang, page, title, dateModified } of response.results.bindings) {
		const isMedia = [ 'anime', 'manga' ].includes(type.value);
		const typeKey = isMedia ? 'media' : type.value;
		const item = data[typeKey][id.value] ??= { dateModified: dateModified.value };
		if (isMedia) {
			isAnimeMap[id.value] ??= type.value === 'anime';
		}
		if (type.value === 'anime') {
			if (dataSource[id.value] === undefined) {
				dataSource[id.value] = Number(source?.value || 0);
			} else if (Object.keys(item.title).length === 1 && item.title.en) {
				dataSource[id.value] = Number(source?.value || 0);
				// The 'en' entry we dropped can have a different dateModified value
				item.dateModified = dateModified.value;
				delete item.title.en;
			} else if (dataSource[id.value] !== Number(source?.value || 0)) {
				continue;
			}
		}

		if (page) {
			item.page = page.value;
		}
		item.title ??= {};
		item.title[lang.value] = normalizeTitle(title.value);
	}
}

const awaiter = new NodeAwaiter();
const conversionManager = new ChineseConversionManager(new ChineseConversionProvider(awaiter));
for (const type in data) {
	await processDataGroup(data[type], type);
}

const mediaPart =
	stringifyPart(data.media, true, (key) => isAnimeMap[key]).slice(0, -1).trimEnd() +
	',\n' +
	stringifyPart(data.media, true, (key) => !isAnimeMap[key]).slice(1);
fs.writeFileSync('./wikidata.json',
	`{\n"media": ${mediaPart},\n"staff": ${stringifyPart(data.staff, true)},\n"character": ${stringifyPart(data.character, true)}\n}`
);
fs.writeFileSync('./wikidata-anime.json', stringifyPart(data.media, false, (key) => isAnimeMap[key]));

async function processDataGroup(data, type) {
	for (const id in data) {
		const idType = type === 'media' ? (isAnimeMap[id] ? 'anime' : 'manga') : type;
		if (data[id].dateModified < wikidata[type][id]?.dateModified) {
			const removed = diff(data[id], wikidata[type][id]);
			const removedLang = Object.keys(removed.title || {}).filter(key => removed.title[key]);

			// We only keep the English title if no Chinese ones are present.
			// In that case the "outdated" new modification date can be from another entity and not relevant.
			if (removed.page || removedLang.length > 1 || removedLang[0] !== 'en') {
				const differ = JSON.stringify(removed, null, '\t');
				core.warning(`Wikidata out of sync for ${idType} ${id}: ${differ}`);
				console.warn(`Wikidata out of sync for ${idType} ${id}: ${differ}`);
				data[id] = wikidata[type][id];
				continue;
			}
		}

		if (!data[id].title['zh'] && !data[id].title['en'] && (!data[id].title['zh-hans'] || !data[id].title['zh-hant'])) {
			console.warn(`Missing untransliterated Chinese title for ${idType} ${id}: ${JSON.stringify(data[id].title)}`);
		}

		if (data[id].title['zh-cn'] && !data[id].title['zh-hans']) {
			console.log(`Missing simplified Chinese title for ${idType} ${id}: ${data[id].title['zh-cn']}`);
		} else if (data[id].title['zh-hans'] && data[id].title['zh-cn'] &&
			data[id].title['zh-cn'] !== data[id].title['zh-hans'] &&
			!data[id].title['zh-hans'].includes('GUNDAM')) {
			// Anti censorship
			const censorRegex = /神社|后宫/;
			if (data[id].title['zh-hans'].match(censorRegex) && !data[id].title['zh-cn'].match(censorRegex)) {
				delete data[id].title['zh-cn'];
			} else {
				console.log(
					`Inconsistent Chinese titles for ${idType} ${id}: ${data[id].title['zh-hans']} ≠ ${data[id].title['zh-cn']}`
				);
			}
		}

		const variants = wikidata[type][id]?.title || {};
		const filtered = Object.fromEntries(
			Object.entries(variants).filter(([lang]) => lang.startsWith('zh'))
		);
		const original = buildFullMapFromFallbacks(filtered);
		const updated = buildFullMapFromFallbacks(data[id].title);
		const differ = diff(original, updated);
		if (data[id].page === wikidata[type][id]?.page && !Object.keys(differ).length) {
			// Nothing changed other than dateModified
			if (data[id].dateModified >= wikidata[type][id]?.dateModified) {
				data[id] = wikidata[type][id];
			}
			continue;
		}

		const langs = Object.keys(data[id].title);
		if (langs.length > 1 || langs[0] !== 'en') {
			conversionManager.queue(id, data[id].title);
		}
	}

	const convertedMap = await conversionManager.getConvertedMap();
	for (const id in convertedMap) {
		const added = convertedMap[id]._?.added;
		if (added && added.includes('zh-hans') && added.includes('zh-hant')) {
			const idType = type === 'media' ? (isAnimeMap[id] ? 'anime' : 'manga') : type;
			console.warn(`The Wikidata entry for ${idType} ${id} is likely malformed: ${JSON.stringify(convertedMap[id])}`);
		}
		data[id].title = convertedMap[id];
	}

	// fs.writeFileSync(`./wikidata-${type}.json`, stringifyPart(data));
}

function stringifyPart(map, includeMetadata = false, toKeep = (key) => true) {
	return JSON.stringify(map, (key, value) => {
		if (includeMetadata && key === 'title' && value._?.added) {
			return Object.fromEntries(Object.entries(value).map(
				([lang, title]) => [ value._.added.includes(lang) ? '+' + lang : lang, title ]
			));
		} else if (!includeMetadata && key === 'title') {
			// Unchanged entries from wikidata.json come with metadata and are prefixed
			return Object.fromEntries(Object.entries(value).map(
				([lang, title]) => [ lang.startsWith('+') ? lang.slice(1) : lang, title ]
			));
		}
		return (
			(!includeMetadata && 'dateModified' === key) ||
			(key && !isNaN(key) && typeof value === 'object' && !toKeep(key))
		) ? undefined : value;
	}, '\t');
}
