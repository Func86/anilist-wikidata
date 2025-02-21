import fs from 'node:fs';

import { SPARQLQueryDispatcher } from '../utils/SPARQLQueryDispatcher.js';
import { replaceWaseiKanji } from './Wasei-Kanji.js';

import staffCatalog from '../catalogs/staff.json' with { type: 'json' };

const queryDispatcher = new SPARQLQueryDispatcher();

const matchedQuery = `\
SELECT DISTINCT ?staffId WHERE {
  ?staff wdt:P11227 ?staffId.
}`;
const matchedResponse = await queryDispatcher.query(matchedQuery);

const matchedEntity = {};
for (const { staffId } of matchedResponse.results.bindings) {
	matchedEntity[staffId.value] = true;
}

const catalogBirthDateMap = {}, catalogBirthDayMap = {};
for (const staff of Object.values(staffCatalog)) {
	if (matchedEntity[staff.id]) {
		continue;
	}
	if (staff.dateOfBirth.month && staff.dateOfBirth.day) {
		catalogBirthDayMap[staff.dateOfBirth.month] ??= {};
		catalogBirthDayMap[staff.dateOfBirth.month][staff.dateOfBirth.day] ??= [];
		catalogBirthDayMap[staff.dateOfBirth.month][staff.dateOfBirth.day].push(staff.id);

		if (staff.dateOfBirth.year) {
			const timestamp = Date.UTC(staff.dateOfBirth.year, staff.dateOfBirth.month - 1, staff.dateOfBirth.day);
			catalogBirthDateMap[timestamp] ??= [];
			catalogBirthDateMap[timestamp].push(staff.id);
		}
	}
}

const otherIdsQuery = `\
SELECT DISTINCT ?item WHERE {
  ?item (wdt:P31/(wdt:P279*)) wd:Q63871467;
        (wdt:P31/(wdt:P279*)) wd:Q19595382.
}`;
const otherIdsResponse = await queryDispatcher.query(otherIdsQuery);

const otherIds = [];
for (const { item } of otherIdsResponse.results.bindings) {
	otherIds.push(item.value.split('/').pop());
}

const staffQuery = `\
SELECT
  ?staff
  (SAMPLE(?jaLabel) AS ?jaLabel)
  (SAMPLE(?enLabel) AS ?enLabel)
  (SAMPLE(?birthDate) AS ?birthDate)
  (SAMPLE(?birthDayLabel) AS ?birthDay)
  (SAMPLE(?precision) AS ?precision)
WHERE {
  {
    SELECT DISTINCT ?staff WHERE {
      { ?staff wdt:${otherIds.join(` []. } UNION
      { ?staff wdt:`)} []. }
    }
  }

  OPTIONAL {
    ?staff p:P569/psv:P569 [
      wikibase:timeValue ?birthDate;
      wikibase:timePrecision ?precision;
    ].
  }
  OPTIONAL { ?staff wdt:P3150 ?birthDay. }
  OPTIONAL { ?staff wdt:P11227 ?anilistId. }

  FILTER((BOUND(?birthDate) || isLiteral(?birthDay)) && !BOUND(?anilistId))

  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?birthDay rdfs:label ?birthDayLabel.
  }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "ja".
    ?staff rdfs:label ?jaLabel.
  }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?staff rdfs:label ?enLabel.
  }
  FILTER(LANG(?jaLabel) = "ja" || LANG(?enLabel) = "en")
}
GROUP BY ?staff
ORDER BY ?precision ?birthDay ?birthDate`;

const response = await queryDispatcher.query(staffQuery);

const data = [];
for (const { staff, jaLabel, enLabel, birthDate, birthDay, precision } of response.results.bindings) {
	const fullPrecision = precision?.value === '11';
	const labels = [ jaLabel, enLabel ]
		.filter(label => label['xml:lang'] && label.value)
		.map(label => label.value);
	if (!fullPrecision && !birthDay) {
		console.log(`No precise birth day for ${staff.value} (${labels[0]})`);
		continue;
	}
	const entityId = staff.value.match(/Q\d+$/)[0];
	const timestamp = Date.parse(fullPrecision ? birthDate.value : `${birthDay.value} GMT`);
	let matched = false;
	if (fullPrecision) {
		for (const staffId of catalogBirthDateMap[timestamp] || []) {
			const names = staffCatalog[staffId].name;
			const nameInCatalog = names.native || names.full;
			for (const label of labels) {
				if (compareNativeName(nameInCatalog, label)) {
					console.log(`Matched ${entityId} to ${staffId}: ${nameInCatalog} = ${label}`);
					data.push([entityId, 'P11227', `"${staffId}"`]);
					matched = true;
					break;
				}
			}
			if (matched) break;
			console.error(`Mismatched names (${staffId} vs ${entityId}): ${nameInCatalog} vs ${labels.join(' / ')}`);
		}
		if (matched) continue;
	}
	const date = new Date(timestamp);
	for (const staffId of catalogBirthDayMap[date.getUTCMonth() + 1]?.[date.getUTCDate()] || []) {
		const names = staffCatalog[staffId].name;
		const nameInCatalog = names.native || names.full;
		for (const label of labels) {
			if (compareNativeName(nameInCatalog, label)) {
				console.log(`R2 Matched ${entityId} to ${staffId}: ${nameInCatalog} = ${label}`);
				data.push([entityId, 'P11227', `"${staffId}"`]);
				matched = true;
				break;
			}
		}
		if (matched) break;
		// console.error(`R2 Mismatched names (${staffId} vs ${entityId}): ${nameInCatalog} vs ${labels.join(' / ')}`);
	}
}

fs.writeFileSync('wikidata-match.tsv', data.map(row => row.join('\t')).join('\n'));

/**
 * Compares two native names for equality, ignoring case and whitespace.
 *
 * @param {string} nameA - The first native name to compare.
 * @param {string} nameB - The second native name to compare.
 * @returns {boolean} - Returns true if the names are equal, ignoring case and whitespace; otherwise, false.
 */
function compareNativeName(nameA, nameB) {
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
	if (longer.length > 1) {
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
