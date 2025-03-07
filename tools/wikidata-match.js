import fs from 'node:fs';

import { SPARQLQueryDispatcher } from '../utils/SPARQLQueryDispatcher.js';
import { replaceWaseiKanji } from './Wasei-Kanji.js';

const catalogName = 'staff'; // 'characters'
const catalogRecords = JSON.parse(fs.readFileSync(`../catalogs/${catalogName}.json`, 'utf8'));

const queryDispatcher = new SPARQLQueryDispatcher();

const entryIdMap = {
	staff: 'P11227',
	characters: 'P11736',
}
const matchedQuery = `\
SELECT DISTINCT ?entryId WHERE {
  ?entity wdt:${entryIdMap[catalogName]} ?entryId.
}`;
const matchedResponse = await queryDispatcher.query(matchedQuery);

const matchedEntry = {};
for (const { entryId } of matchedResponse.results.bindings) {
	matchedEntry[entryId.value] = true;
}

const catalogBirthMap = {};
for (const entry of Object.values(catalogRecords)) {
	if (matchedEntry[entry.id]) {
		continue;
	}
	if (entry.dateOfBirth.month && entry.dateOfBirth.day) {
		catalogBirthMap[entry.dateOfBirth.month] ??= {};
		catalogBirthMap[entry.dateOfBirth.month][entry.dateOfBirth.day] ??= [];
		catalogBirthMap[entry.dateOfBirth.month][entry.dateOfBirth.day].push({
			id: entry.id,
			year: entry.dateOfBirth.year,
		});
	}
}

const instanceOfMap = {
	staff: 'Q19595382',
	characters: 'Q89209418',
};
const otherIdsQuery = `\
SELECT DISTINCT ?item ?itemLabel WHERE {
  ?item (wdt:P31/(wdt:P279*)) wd:Q63871467;
        (wdt:P31/(wdt:P279*)) wd:${instanceOfMap[catalogName]}.

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
const otherIdsResponse = await queryDispatcher.query(otherIdsQuery);

const otherIds = [];
const otherIdDenyList = [ entryIdMap[catalogName], 'P5905', 'P6327', 'P8419', 'P13236' ];
for (const { item, itemLabel } of otherIdsResponse.results.bindings) {
	const otherId = item.value.split('/').pop();
	if (otherIdDenyList.includes(otherId)) {
		continue;
	}
	otherIds.push(otherId);
	console.log(`* ${otherId}: ${itemLabel.value}`);
}

const entityQuery = `\
SELECT
  ?entity
  (SAMPLE(?jaLabel) AS ?jaLabel)
  (SAMPLE(?enLabel) AS ?enLabel)
  (SAMPLE(?birthDate) AS ?birthDate)
  (SAMPLE(?birthDayLabel) AS ?birthDay)
  (SAMPLE(?precision) AS ?precision)
WHERE {
  {
    SELECT DISTINCT ?entity WHERE {
      { ?entity wdt:${otherIds.join(` []. } UNION
      { ?entity wdt:`)} []. }

      FILTER ${catalogName !== 'staff' ? 'NOT' : ''} EXISTS { ?entity wdt:P31 wd:Q5. }
    }
  }

  OPTIONAL {
    ?entity p:P569 [
      rdf:type wikibase:BestRank;
      psv:P569 [
        wikibase:timeValue ?birthDate;
        wikibase:timePrecision ?precision;
      ];
    ].
  }
  OPTIONAL { ?entity wdt:P3150 ?birthDay. }
  OPTIONAL { ?entity wdt:${entryIdMap[catalogName]} ?anilistId. }

  FILTER((BOUND(?birthDate) || isLiteral(?birthDay)) && !BOUND(?anilistId))

  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?birthDay rdfs:label ?birthDayLabel.
  }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "ja".
    ?entity rdfs:label ?jaLabel.
  }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?entity rdfs:label ?enLabel.
  }
  FILTER(LANG(?jaLabel) = "ja" || LANG(?enLabel) = "en")
}
GROUP BY ?entity
ORDER BY ?precision ?birthDay ?birthDate`;

const response = await queryDispatcher.query(entityQuery);

const data = [];
for (const { entity, jaLabel, enLabel, birthDate, birthDay, precision } of response.results.bindings) {
	const fullPrecision = precision?.value === '11';
	const labels = [ jaLabel, enLabel ]
		.filter(label => label['xml:lang'] && label.value)
		.map(label => label.value);
	if (!fullPrecision && !birthDay) {
		console.log(`No precise birth day for ${entity.value} (${labels[0]})`);
		continue;
	}
	const entityId = entity.value.match(/Q\d+$/)[0];
	const date = new Date(Date.parse(fullPrecision ? birthDate.value : `${birthDay.value} GMT`));
	const candidates = catalogBirthMap[date.getMonth() + 1]?.[date.getDate()].filter(
		({ year }) => !year || !fullPrecision || year === date.getFullYear()
	);
	for (const { id: entryId, year } of candidates || []) {
		const names = catalogRecords[entryId].name;
		const matched = compareNames(names, jaLabel, enLabel, fullPrecision && year);
		if (matched) {
			console.log(`Matched ${entityId} to ${entryId}: ${matched.name} = ${matched.label}`);
			data.push([entityId, entryIdMap[catalogName], `"${entryId}"`]);
			break;
		}
		if (fullPrecision && year) {
			console.error(`Mismatched names (${entityId} vs ${entryId}): ${labels.join(' / ')} vs ${names.native || names.full}`);
		}
	}
}

fs.writeFileSync('wikidata-match.tsv', data.map(row => row.join('\t')).join('\n'));

function compareNames(names, jaLabel, enLabel, allowAmbiguity = false) {
	const toCompare = [
		[ names.native, jaLabel ],
		[ names.native, enLabel ],
		[ names.full, enLabel ],
		...names.alternative.map(name => [ name, jaLabel ]),
		...names.alternative.map(name => [ name, enLabel ]),
	];

	for (const [ nameInCatalog, label ] of toCompare) {
		if (!label['xml:lang'] || !label.value) {
			continue;
		}
		if (compareNativeName(nameInCatalog, label.value, allowAmbiguity)) {
			return { name: nameInCatalog, label: label.value };
		}
	}

	return null;
}

/**
 * Compares two native names for equality, ignoring case and whitespace.
 *
 * @param {string} nameA  The first native name to compare.
 * @param {string} nameB  The second native name to compare.
 * @param {boolean} [allowAmbiguity=false]  Whether to allow more ambiguity for the name.
 * @returns {boolean}  Returns true if the names are equal, ignoring case and whitespace; otherwise, false.
 */
function compareNativeName(nameA, nameB, allowAmbiguity = false) {
	if (!nameA || !nameB) {
		return false;
	}

	const kanjiRegex = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
	const hasKanji = kanjiRegex.test(nameA) && kanjiRegex.test(nameB);
	const normalizedA = replaceWaseiKanji(nameA.replaceAll(/\s+/g, hasKanji ? '' : ' ')).trim().toLowerCase();
	const normalizedB = replaceWaseiKanji(nameB.replaceAll(/\s+/g, hasKanji ? '' : ' ')).replace(/\s*\(.+\)$/, '').trim().toLowerCase();
	if (normalizedA.localeCompare(normalizedB) === 0) {
		return true;
	}

	const wordsA = normalizedA.split(' ');
	const wordsB = normalizedB.split(' ');
	// For romaji names, the longer name should contain all words from the shorter name
	const [ longer, shorter ] = wordsA.length > wordsB.length ? [ wordsA, wordsB ] : [ wordsB, wordsA ];
	// When the date of birth exactly matched, we can allow more ambiguity for the name
	if ((allowAmbiguity ? longer.length : shorter.length) > 1) {
		for (const word of shorter) {
			if (!longer.includes(word)) {
				return false;
			}
		}
		return true;
	}

	// The order of first name and last name can be inverted
	if (hasKanji && normalizedA.length === normalizedB.length) {
		for (let i = 1; i < normalizedA.length; i++) {
			const parts = [ normalizedA.slice(0, i), normalizedA.slice(i) ];
			const partIndex = normalizedB.indexOf(parts[0]);
			if (partIndex === -1) {
				break;
			}
			if (partIndex === normalizedB.length - parts[0].length && normalizedB.startsWith(parts[1])) {
				return true;
			}
		}
	}

	return false;
}
