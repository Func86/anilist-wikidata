import fs from 'node:fs';
import core from '@actions/core';
import { diff } from 'deep-object-diff';

import wikidata from './wikidata.json' assert { type: 'json' };

const sparqlQuery = `\
SELECT (MIN(xsd:integer(?value)) AS ?id)
       ?isAnime
       ?source
       ?lang
       (SAMPLE(?label) AS ?title)
       (SAMPLE(?finalPage) AS ?page)
       (SAMPLE(?dateModified) AS ?dateModified)
WHERE {{
  BIND(true AS ?isAnime)
  {
    ?item wdt:P8729 ?value.

    OPTIONAL { ?item wdt:P364 ?originalLanguage. }
    FILTER(?originalLanguage = wd:Q5287 || !BOUND(?originalLanguage))

    ?item rdfs:label ?label.
    BIND(LANG(?label) AS ?lang)
    FILTER(STRSTARTS(?lang, "zh") || ?lang = "en")

    ?item schema:dateModified ?dateModified.
    BIND(0 AS ?source).
  } UNION {
    ?item wdt:P8729 ?value.

    OPTIONAL { ?item wdt:P364 ?originalLanguage. }
    FILTER(?originalLanguage = wd:Q5287 || !BOUND(?originalLanguage))

    # In this branch of the UNION query, we only want items with P144 (origin) statements, but somehow,
    # keeping these inside an OPTIONAL block can make the query way faster, from >20s to 6-8s
    OPTIONAL {
      ?item wdt:P144 ?origin.
      ?origin schema:dateModified ?dateModified.
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "zh,zh-hans,zh-hant,zh-cn,zh-tw,zh-hk,zh-sg,zh-mo,zh-my,en".
        ?item rdfs:label ?autoLabel.
        ?origin rdfs:label ?originLabel.
      }
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "en".
        ?item rdfs:label ?enLabel.
        ?origin rdfs:label ?originEnLabel.
      }
    }

    # Query the title variants of the origin entity, when all of the following conditions are met:
    # 1. The title of the item is in English or undefined
    # 2. The title of the origin entity is in Chinese
    # 3. The English title of the item is the same as the English title of the origin entity
    # We have to use a UNION query because the it would timeout/OOM when querying rdfs:label on variables
    # that are bounded with BIND, even if it's as simple as BIND(?item AS ?itemCopy).
    FILTER(!STRSTARTS(LANG(?autoLabel), "zh") && STRSTARTS(LANG(?originLabel), "zh") && ?enLabel = ?originEnLabel)
    ?origin rdfs:label ?label.
    BIND(LANG(?label) AS ?lang)
    FILTER(STRSTARTS(?lang, "zh"))
    BIND(1 AS ?source).
  } UNION {
    ?item wdt:P8729 ?value.

    OPTIONAL { ?item wdt:P364 ?originalLanguage. }
    FILTER(?originalLanguage = wd:Q5287 || !BOUND(?originalLanguage))

    ?item p:P179 [
      pq:P1545 "1";
      ps:P179 ?series;
    ].
    ?series rdfs:label ?label.
    BIND(LANG(?label) AS ?lang).
    FILTER(STRSTARTS(?lang, "zh")).

    ?series schema:dateModified ?dateModified.
    BIND(2 AS ?source).
  }

  OPTIONAL { ?item wdt:P5737 ?page }

  OPTIONAL {
    ?item wdt:P179 ?series
    OPTIONAL { ?series wdt:P5737 ?seriesPage }
    OPTIONAL { ?series wdt:P144/wdt:P5737 ?seriesOriginPage }
    # The link to the media mix page of the series
    OPTIONAL { ?series wdt:P8345/wdt:P5737 ?seriesMedmixPage }
  }

  OPTIONAL {
    ?item wdt:P144 ?origin
    OPTIONAL {
      ?origin p:P5737 ?originPageStatement.
      ?originPageStatement ps:P5737 ?originPage.
      # Using "p:" and then "ps:" instead of "wdt:" would cause the deprecated ones to be included,
      # so we need to filter them out manually
      ?originPageStatement wikibase:rank ?originPageRank
      # Filter out pages in non-Chinese languages
      OPTIONAL { ?originPageStatement pq:P407 ?originPageLang }
    }
    FILTER(?originPageRank != wikibase:DeprecatedRank && (!BOUND(?originPageLang) || ?originPageLang = wd:Q7850))
    # Somehow querying the media mix of the series would cause the order of the results to be different,
    # so we need to query more specifically before fallback to the origin page
    OPTIONAL { ?origin wdt:P361/wdt:P5737 ?originEntityPage }
  }

  OPTIONAL { ?item wdt:P8345/wdt:P5737 ?medmixPage }

  BIND(COALESCE(?page, ?seriesPage, ?seriesOriginPage, ?originEntityPage, ?originPage, ?medmixPage, ?seriesMedmixPage) AS ?finalPage)
  FILTER(STRSTARTS(?lang, "zh") || BOUND(?finalPage))
} UNION {
  ?item wdt:P8731 ?value.
  BIND(false AS ?isAnime)

  OPTIONAL { ?item wdt:P364 ?originalLanguage. }
  FILTER(?originalLanguage = wd:Q5287 || !BOUND(?originalLanguage))

  ?item rdfs:label ?label.
  BIND(LANG(?label) AS ?lang)
  FILTER(STRSTARTS(?lang, "zh"))

  ?item schema:dateModified ?dateModified.
}}
GROUP BY ?isAnime ?item ?source ?lang
ORDER BY DESC(?isAnime) ?id ?source ?lang`;

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

		const body = await fetch(fullUrl, { headers });
		return await body.json();
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
		// The 'en' entry which we dropped can have a different dateModified value
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
