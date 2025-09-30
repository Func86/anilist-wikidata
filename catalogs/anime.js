import { nameList, normalizeSpace } from './helpers.js';

function entryCallback(entry) {
	const description = [];
	if (entry.title.native) {
		description.push(normalizeSpace(entry.title.native));
	}
	const credits = [];
	if (entry.startDate.year) {
		credits.push(entry.startDate.year);
	}
	credits.push('anime');
	if (entry.studios.nodes.length) {
		credits.push('by', nameList(
			entry.studios.nodes.map(studio => studio.name)
		));
	}
	description.push(credits.join(' '));
	const director = entry.staff.edges.find(edge => edge.role === 'Director');
	if (director) {
		description.push(`Directed by ${normalizeSpace(director.node.name.full)}`);
	}
	return {
		id: entry.id,
		name: normalizeSpace(entry.title.english || entry.title.romaji || entry.title.native),
		type: guessEntityType(entry),
		url: entry.siteUrl,
		P4086: entry.idMal,
		description: description.join('. '),
	}
}

/**
 * Guesses the entity type based on the given entry's format, country of origin, and relations.
 *
 * @param {Object} entry - The entry object containing details about the anime.
 * @param {string} entry.format - The format of the anime (e.g., 'TV', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC').
 * @param {string} entry.countryOfOrigin - The country of origin of the anime (e.g., 'JP' for Japan).
 * @param {number} [entry.episodes] - The number of episodes (optional, used for 'OVA' and 'ONA' formats).
 * @param {Object} entry.relations - The relations object containing edges.
 * @param {Array} entry.relations.edges - An array of relation edges.
 * @param {string} entry.relations.edges[].relationType - The type of relation (e.g., 'PREQUEL', 'SEQUEL').
 * @returns {string|null} - The guessed entity type ID or null if the format is unknown.
 */
function guessEntityType(entry) {
	const isSeason = entry.relations.edges.some(edge => ['PREQUEL', 'SEQUEL'].includes(edge.relationType));
	switch (entry.format) {
		case 'TV':
		case 'TV_SHORT':
			if (entry.countryOfOrigin === 'JP') {
				if (isSeason) {
					return 'Q100269041';
				} else {
					return 'Q63952888';
				}
			} else {
				if (isSeason) {
					return 'Q125354488';
				} else {
					return 'Q117467246';
				}
			}
		case 'MOVIE':
			if (entry.countryOfOrigin === 'JP') {
				return 'Q20650540';
			} else {
				return 'Q202866';
			}
		case 'SPECIAL':
			return 'Q1107'; // idk, we will see
		case 'OVA':
			if (entry.episodes > 1) {
				return 'Q113687694';
			} else {
				return 'Q220898';
			}
		case 'ONA':
			if (entry.countryOfOrigin === 'JP' && entry.episodes > 1) {
				return 'Q113671041';
			} else {
				return 'Q1047299';
			}
		case 'MUSIC':
			return 'Q64100970';
		case null:
			console.log(`No format for ${entry.id}`);
			return null;
		default:
			console.log(`Unknown format: ${entry.format} for ${entry.id}`);
			return null;
	}
}

export { entryCallback };
