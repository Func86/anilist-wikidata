import fs from 'node:fs';
import core from '@actions/core';
import { diff } from 'deep-object-diff';

import wikidata from './wikidata.json' with { type: 'json' };
import {
	ChineseConversionManager, ChineseConversionProvider,
	normalizeTitle, buildFullMapFromFallbacks
} from './utils/ChineseConversionManager.js';
import { NodeAwaiter } from './utils/awaiters.js';

const sparqlQuery = fs.readFileSync('./wikidata.rq', 'utf8');

class SPARQLQueryDispatcher {
	constructor() {
		this.endpoint = 'https://query.wikidata.org/sparql';
	}

	async query() {
		const headers = {
			'Accept': 'application/sparql-results+json',
			'Content-Type': 'application/sparql-query',
			'User-Agent': 'AcgServiceBot/0.1 (https://github.com/Func86/anilist-wikidata)',
		};

		const response = await fetch(this.endpoint, {
			method: 'POST',
			headers,
			body: sparqlQuery,
		});
		try {
			return await response.clone().json();
		} catch (error) {
			console.error(await response.text());
			throw error;
		}
	}
}

const data = {}, dataSource = {}, isAnimeMap = {};
const queryDispatcher = new SPARQLQueryDispatcher();
const response = await queryDispatcher.query();
for (const { id, isAnime, source, lang, page, title, dateModified } of response.results.bindings) {
	const item = data[id.value] ??= { dateModified: dateModified.value };
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

	isAnimeMap[id.value] ??= isAnime.value === 'true';
	if (page) {
		item.page = page.value;
	}
	item.title ??= {};
	item.title[lang.value] = normalizeTitle(title.value);
}

const awaiter = new NodeAwaiter();
const conversionManager = new ChineseConversionManager(new ChineseConversionProvider(awaiter));
for (const id in data) {
	if (data[id].dateModified < wikidata[id]?.dateModified) {
		const removed = diff(data[id], wikidata[id]);
		const removedLang = Object.keys(removed.title).filter(key => removed.title[key]);

		// We only keep the English title if no Chinese ones are present.
		// In that case the "outdated" new modification date can be from another entity and not relevant.
		if (removed.page || removedLang.length > 1 || removedLang[0] !== 'en') {
			const differ = JSON.stringify(removed, null, '\t');
			core.warning(`Wikidata out of sync for ${isAnimeMap[id] ? 'anime' : 'manga'} ${id}: ${differ}`);
			console.warn(`Wikidata out of sync for ${isAnimeMap[id] ? 'anime' : 'manga'} ${id}: ${differ}`);
			data[id] = wikidata[id];
			continue;
		}
	}

	if (!data[id].title['zh'] && !data[id].title['en'] && (!data[id].title['zh-hans'] || !data[id].title['zh-hant'])) {
		console.warn(`Missing untransliterated Chinese title for ${isAnimeMap[id] ? 'anime' : 'manga'} ${id}: ${JSON.stringify(data[id].title)}`);
	}

	if (data[id].title['zh-cn'] && !data[id].title['zh-hans']) {
		console.log(`Missing simplified Chinese title for ${isAnimeMap[id] ? 'anime' : 'manga'} ${id}: ${data[id].title['zh-cn']}`);
	} else if (
		data[id].title['zh-hans'] && data[id].title['zh-cn'] &&
		data[id].title['zh-cn'] !== data[id].title['zh-hans'] &&
		!data[id].title['zh-hans'].includes('GUNDAM')
	) {
		// Anti censorship
		const censorRegex = /神社|后宫/;
		if (data[id].title['zh-hans'].match(censorRegex) && !data[id].title['zh-cn'].match(censorRegex)) {
			delete data[id].title['zh-cn'];
		} else {
			console.log(
				`Inconsistent Chinese titles for ${isAnimeMap[id] ? 'anime' : 'manga'} ${id}: ` +
				`${data[id].title['zh-hans']} ≠ ${data[id].title['zh-cn']}`
			);
		}
	}

	const { _: added, ...variants } = wikidata[id]?.title || {};
	const filtered = !added ? variants : Object.fromEntries(
		Object.entries(variants).filter(([lang]) => !added.includes(lang))
	);
	const original = buildFullMapFromFallbacks(filtered);
	const updated = buildFullMapFromFallbacks(data[id].title);
	const differ = diff(original, updated);
	if (data[id].page === wikidata[id]?.page && !Object.keys(differ).length) {
		// Nothing changed other than dateModified
		if (data[id].dateModified >= wikidata[id]?.dateModified) {
			data[id] = wikidata[id];
		}
		continue;
	}

	const langs = Object.keys(data[id].title);
	if (langs.length > 1 || langs[0] !== 'en') {
		conversionManager.queue(id, data[id].title);
	}
}

if (conversionManager.needsConversion()) {
	const convertedMap = await conversionManager.convert();
	for (const id in convertedMap) {
		const { _: differ, ...titles } = convertedMap[id];
		const added = differ?.added;
		if (added && added.includes('zh-hans') && added.includes('zh-hant')) {
			console.warn(`The Wikidata entry for ${isAnimeMap[id] ? 'anime' : 'manga'} ${id} is likely malformed: ${JSON.stringify(convertedMap[id])}`);
		}
		data[id].title = titles;
		data[id].title._ = added;
	}
}

fs.writeFileSync('./wikidata.json',
	JSON.stringify(data, (key, value) => {
		return (key && !isNaN(key) && typeof value === 'object' && !isAnimeMap[key]) ? undefined : value;
	}, '\t').slice(0, -1).trimEnd() + ',\n' + JSON.stringify(data, (key, value) => {
		return (key && !isNaN(key) && typeof value === 'object' && isAnimeMap[key]) ? undefined : value;
	}, '\t').slice(1)
);
fs.writeFileSync('./wikidata-anime.json',
	JSON.stringify(data, (key, value) => {
		return (
			[ 'dateModified', '_' ].includes(key) ||
			(key && !isNaN(key) && typeof value === 'object' && !isAnimeMap[key])
		) ? undefined : value;
	}, '\t')
);
