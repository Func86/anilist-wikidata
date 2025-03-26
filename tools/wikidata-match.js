import fs from 'fs';
import * as chrono from 'chrono-node';
import Papa from 'papaparse';

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
	const dateOfBirth = Object.values(entry.dateOfBirth).filter(Boolean).length > 0
		? entry.dateOfBirth
		: extractDateOfBirthFromDescription(entry) || {};
	if (dateOfBirth.month && dateOfBirth.day) {
		catalogBirthMap[dateOfBirth.month] ??= {};
		catalogBirthMap[dateOfBirth.month][dateOfBirth.day] ??= [];
		catalogBirthMap[dateOfBirth.month][dateOfBirth.day].push({
			id: entry.id,
			year: dateOfBirth.year,
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
		console.log(`No precise birth day for ${entity.value} (${labels.join(' / ')})`);
		continue;
	}
	const entityId = entity.value.match(/Q\d+$/)[0];
	const date = new Date(Date.parse(fullPrecision ? birthDate.value : `${birthDay.value} GMT`));
	const candidates = catalogBirthMap[date.getUTCMonth() + 1]?.[date.getUTCDate()].filter(
		({ year }) => !year || !fullPrecision || year === date.getUTCFullYear()
	);
	for (const { id: entryId, year } of candidates || []) {
		const names = catalogRecords[entryId].name;
		const matched = compareNames(names, jaLabel, enLabel, fullPrecision && year);
		if (matched) {
			console.log(`Matched ${entityId} to ${entryId}: ${matched.name} = ${matched.label}`);
			data.push({ id: entityId, [entryIdMap[catalogName]]: entryId });
			break;
		}
		if (fullPrecision && year) {
			console.error(`Mismatched names (${entityId} vs ${entryId}): ${labels.join(' / ')} vs ${(names.native || names.full).trim()} (${year})`);
		}
	}
}

fs.writeFileSync('wikidata-match.tsv', Papa.unparse(data, { delimiter: '\t', newline: '\n' }));

function compareNames(names, jaLabel, enLabel, allowAmbiguity = false) {
	// U+201A: SINGLE LOW-9 QUOTATION MARK (misused as a comma)
	const hasComma = names.full.match(/[,‚]/);
	const native = !names.native ? [] : hasComma ? [ names.native ] : names.native.split(/[,‚]/).map(name => name.trim());
	const alternative = [];
	if (names.full.match(/\(.+\)/)) {
		alternative.push(...names.alternative);
	} else {
		names.alternative.forEach(name => {
			const parts = name.match(/([^()]+?)\s*\((.+)\)$/);
			if (parts) {
				alternative.push(parts[1]);
				if (hasComma) {
					alternative.push(parts[2]);
				} else {
					alternative.push(...parts[2].split(/[,‚]/).map(name => name.trim()));
				}
			} else {
				alternative.push(name);
			}
		});
	}
	const toCompare = [
		...native.map(name => [ name, jaLabel ]),
		...native.map(name => [ name, enLabel ]),
		[ names.full, enLabel ],
		...alternative.map(name => [ name, jaLabel ]),
		...alternative.map(name => [ name, enLabel ]),
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

function extractDateOfBirthFromDescription(entry) {
	if (entry.primaryOccupations.includes('Choir') || entry.primaryOccupations.includes('Band') || !entry.description) {
		return null;
	}
	if (entry.description.match(/\b\d{1,4}(?:st|nd|th)?\b/) &&
		entry.description.match(/(?<!(?:'s|(?:'s Date|Place) of|Gave|(?:announced|since) the|after(?: the)?|st|as her|On his|Jewish) |\/)\bbirth(?!\s*(?:place|Name|day Honours|house|ed by)\b|[.,)]|__: ~)/i) &&
		!entry.description.match(/is a Japanese idol group|\bbirth was privately held\b/i)
	) {
		const rawBirth = entry.description.match(
			/(?:<b>|(\*\*|__|^)|[ ]{3,}|\) )(_)?(?:Date (?:(?:of|to) )?Birth|Birth(?: ?(?:Date|year|day))?)(?::(?: ?<\/b>|\1)|(?:<\/b>|\1):) *(?:\?\? ?\?\?, |xxxx[-/])?((?:(?![ ]{2,})[^:?<\n]){4,24})(?:, \?{4})?(?<![ ,.])\2(?: *$|[ ]{2,}|[.,]).{0,10}/im
		);
		if (rawBirth) {
			if (rawBirth[3].match(/^\d{4}$/)) {
				return { year: parseInt(rawBirth[3]) };
			}
			if (rawBirth[3].match(/\b\d{3}\b/)) {
				console.error({ id: entry.id, description: entry.description });
				return null;
			}
			const normalized = rawBirth[3].replace(/\. ?|-/g, '/')
				.replace(/Feb\w+/i, 'February')
				.replace(/Mar\w+/i, 'March');
			const parsed = chrono.parse(normalized);
			if (parsed.length === 0) {
				console.error({ id: entry.id, description: entry.description });
				return null;
			}
			return parsed[0].start.knownValues;
		} else {
			console.error({ id: entry.id, description: entry.description });
		}
	}
	return null;
}
