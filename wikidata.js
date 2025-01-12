import fs from 'node:fs';
import core from '@actions/core';
import { diff } from 'deep-object-diff';

import wikidata from './wikidata.json' assert { type: 'json' };

const sparqlQuery = fs.readFileSync('./wikidata.rq', 'utf8');

class SPARQLQueryDispatcher {
	constructor() {
		this.endpoint = 'https://query.wikidata.org/sparql';
	}

	async query() {
		const fullUrl = this.endpoint + '?query=' + encodeURIComponent(sparqlQuery);
		const headers = {
			'Accept': 'application/sparql-results+json',
			'User-Agent': 'AcgServiceBot/0.1 (https://github.com/Func86/anilist-wikidata)'
		};

		const response = await fetch(fullUrl, { headers });
		return await response.json();
	}
}

function normalizeTitle(title) {
	return title
		.replace(/[\t\xA0\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F\u2060-\u206E\u3000\u3164\uFEFF]/g, ' ')
		.replaceAll('・', '·')
		.trim();
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

for (const id in data) {
	if (data[id].dateModified < wikidata[id]?.dateModified) {
		const removed = diff(data[id], wikidata[id]);
		Object.keys(removed.title).forEach(key => removed.title[key] === undefined && delete removed.title[key]);
		const diffLang = Object.keys(removed.title);
		console.log(!removed.page, diffLang.length, diffLang[0]);
		if (!removed.page && diffLang.length === 1 && diffLang[0] === 'en') {
			continue;
		}

		const differ = JSON.stringify(removed, null, '\t');
		core.warning(`Wikidata out of sync for ${isAnimeMap[id] ? 'anime' : 'manga'} ${id}: ${differ}`);
		console.warn(`Wikidata out of sync for ${isAnimeMap[id] ? 'anime' : 'manga'} ${id}: ${differ}`);
		data[id] = wikidata[id];
	} else if (data[id].dateModified > wikidata[id]?.dateModified && Object.keys(diff(wikidata[id], data[id])).length === 1) {
		// Nothing changed other than dateModified
		data[id] = wikidata[id];
	}
}

fs.writeFileSync('./wikidata.json',
	JSON.stringify(data, (key, value) => {
		return (key && !isNaN(key) && !isAnimeMap[key]) ? undefined : value;
	}, '\t').slice(0, -1).trimEnd() + ',\n' + JSON.stringify(data, (key, value) => {
		return (key && !isNaN(key) && isAnimeMap[key]) ? undefined : value;
	}, '\t').slice(1)
);
fs.writeFileSync('./wikidata-anime.json',
	JSON.stringify(data, (key, value) => {
		return ('dateModified' === key || (key && !isNaN(key) && !isAnimeMap[key])) ? undefined : value;
	}, '\t')
);
