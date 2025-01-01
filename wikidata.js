import fs from 'node:fs';

const sparqlQuery = `\
SELECT (MIN(xsd:integer(?value)) AS ?animeId)
       ?lang
       (SAMPLE(?label) AS ?title)
       (SAMPLE(?finalPage) AS ?page)
WHERE {
  ?item wdt:P8729 ?value.

  OPTIONAL { ?item wdt:P364 ?originalLanguage. }
  FILTER(?originalLanguage = wd:Q5287 || !BOUND(?originalLanguage))

  ?item rdfs:label ?label.
  BIND(LANG(?label) AS ?lang)
  FILTER(STRSTARTS(?lang, "zh"))

  OPTIONAL { ?item wdt:P5737 ?page }

  OPTIONAL {
    ?item wdt:P179 ?series
    OPTIONAL { ?series wdt:P5737 ?seriesPage }
    OPTIONAL { ?series wdt:P144/wdt:P5737 ?seriesOriginPage }
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
  }

  BIND(COALESCE(?page, ?seriesPage, ?seriesOriginPage, ?originPage) AS ?finalPage)
}
GROUP BY ?item ?lang
ORDER BY ?animeId ?lang`;

class SPARQLQueryDispatcher {
	constructor() {
		this.endpoint = 'https://query.wikidata.org/sparql';
	}

	async query() {
		const fullUrl = this.endpoint + '?query=' + encodeURIComponent(sparqlQuery);
		const headers = {
			'Accept': 'application/sparql-results+json',
			'User-Agent': 'AnimeServiceBot/0.1 (https://github.com/Func86/anilist-wikidata)'
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

const data = {};
const queryDispatcher = new SPARQLQueryDispatcher();
const response = await queryDispatcher.query();
for (const { animeId, lang, page, title } of response.results.bindings) {
	data[animeId.value] ??= {};
	if (page) {
		data[animeId.value].page = page.value;
	}
	data[animeId.value].title ??= {};
	data[animeId.value].title[lang.value] = normalizeTitle(title.value);
}

fs.writeFileSync('./wikidata.json', JSON.stringify(data, null, 2));
