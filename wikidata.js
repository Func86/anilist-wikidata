import fs from 'node:fs';

const sparqlQuery = `\
SELECT (MIN(xsd:integer(?value)) AS ?id)
       ?isAnime
       ?lang
       (SAMPLE(?label) AS ?title)
       (SAMPLE(?finalPage) AS ?page)
WHERE {{
  BIND(true AS ?isAnime)
  {
    ?item wdt:P8729 ?value.

    OPTIONAL { ?item wdt:P364 ?originalLanguage. }
    FILTER(?originalLanguage = wd:Q5287 || !BOUND(?originalLanguage))

    ?item rdfs:label ?label.
    BIND(LANG(?label) AS ?lang)
    FILTER(STRSTARTS(?lang, "zh"))
  } UNION {
    ?item wdt:P8729 ?value.

    OPTIONAL { ?item wdt:P364 ?originalLanguage. }
    FILTER(?originalLanguage = wd:Q5287 || !BOUND(?originalLanguage))

    # In this branch of the UNION query, we only want items with P144 (origin) statements, but somehow,
    # keeping these inside an OPTIONAL block can make the query way faster, from >20s to 6-8s
    OPTIONAL {
      ?item wdt:P144 ?origin.
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
} UNION {
  ?item wdt:P8731 ?value.
  BIND(false AS ?isAnime)

  OPTIONAL { ?item wdt:P364 ?originalLanguage. }
  FILTER(?originalLanguage = wd:Q5287 || !BOUND(?originalLanguage))

  ?item rdfs:label ?label.
  BIND(LANG(?label) AS ?lang)
  FILTER(STRSTARTS(?lang, "zh"))
}}
GROUP BY ?isAnime ?item ?lang
ORDER BY DESC(?isAnime) ?id ?lang`;

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

const animeData = {}, mangaData = {};
const queryDispatcher = new SPARQLQueryDispatcher();
const response = await queryDispatcher.query();
for (const { id, isAnime, lang, page, title } of response.results.bindings) {
	const item = isAnime.value === 'true' ? (animeData[id.value] ??= {}) : (mangaData[id.value] ??= {});
	if (page) {
		item.page = page.value;
	}
	item.title ??= {};
	item.title[lang.value] = normalizeTitle(title.value);
}

fs.writeFileSync(
  './wikidata.json',
  JSON.stringify(animeData, null, '\t').slice(0, -1).trimEnd() + ',\n' + JSON.stringify(mangaData, null, '\t').slice(1)
);
fs.writeFileSync('./wikidata-anime.json', JSON.stringify(animeData, null, '\t'));
