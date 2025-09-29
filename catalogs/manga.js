import { nameList, normalizeSpace } from './helpers.js';

/**
 * Processes an entry and returns a formatted object with its details.
 *
 * @param {Object} entry - The entry object containing details about the entity.
 * @param {number} entry.id - The unique identifier of the entry.
 * @param {number} entry.idMal - The MyAnimeList identifier of the entry.
 * @param {Object} entry.title - The title object of the entry.
 * @param {string} entry.title.english - The English title of the entry.
 * @param {string} entry.title.romaji - The romanized title of the entry.
 * @param {string} entry.title.native - The native title of the entry.
 * @param {Object} entry.startDate - The start date object of the entry.
 * @param {number} entry.startDate.year - The start year of the entry.
 * @param {string} entry.siteUrl - The site URL of the entry.
 * @param {Object} entry.staff 
 * @param {Object[]} entry.staff.edges - An array of staff.
 * @param {string} entry.staff.edges[].role - The role of the staff.
 * @param {Object} entry.staff.edges[].node - The staff info node.
 * @param {string} entry.staff.edges[].node.name - The name object of the staff.
 * @param {string} entry.staff.edges[].node.name.full - The full name of the staff.
 * @returns {Object} - Returns a formatted object with the entry details.
 */
function entryCallback(entry) {
	const description = [];
	if (entry.title.native) {
		description.push(normalizeSpace(entry.title.native));
	}
	const type = guessEntityType(entry);
	const readableType = getReadableEntityType(type);
	let basicInfo = '';
	if (entry.startDate.year || readableType) {
		basicInfo = `${entry.startDate.year || ''} ${readableType || 'work'}`.trimStart();
	}
	if (entry.staff.edges.length) {
		const credits = {};
		const mainStaff = entry.staff.edges.filter(
			// Covers: Lettering/Letterer, Translator/Translation, Assistant/Assistance, Editor/Editing
			staff => staff.role && !staff.role.match(/(?:Letter|Translat|Touch-up|Assist|Edit|Supervisor)/i)
		);
		for (const staff of mainStaff) {
			const matched = staff.role.trim().match(/^([^(]+?)\s*(?:\((.+)\))?$/);
			if (!matched) {
				console.log(`Unexpected value of role: "${staff.role}" for ${entry.id}`);
				continue;
			}
			const [ , role, qualifier ] = matched;
			credits[role] = credits[role] || [];
			if (qualifier) {
				credits[role].push(`${staff.node.name.full} (${qualifier})`);
			} else {
				credits[role].push(staff.node.name.full);
			}
		}
		const roles = Object.keys(credits);
		if (roles.length === 1 && basicInfo) {
			description.push(`${basicInfo} by ${nameList(credits[roles[0]])}`);
		} else {
			const creditLines = [];
			for (const [role, names] of Object.entries(credits)) {
				creditLines.push(`${role}: ${nameList(names)}`);
			}
			if (basicInfo) {
				description.push(basicInfo);
			}
			description.push(creditLines.join(', '));
		}
	} else if (basicInfo) {
		description.push(basicInfo);
	}

	return {
		ID: entry.id,
		name: normalizeSpace(entry.title.english || entry.title.romaji || entry.title.native),
		type,
		URL: entry.siteUrl,
		P4087: entry.idMal,
		description: description.join('. '),
	};
}

/**
 * Guesses the entity type based on the format and country of origin of the entry.
 *
 * @param {Object} entry - The entry object containing details about the entity.
 * @param {string} entry.format - The format of the entry (e.g., 'MANGA', 'ONE_SHOT', 'NOVEL').
 * @param {string} [entry.countryOfOrigin] - The country of origin of the entry (e.g., 'JP', 'KR', 'CN').
 * @param {string} entry.id - The unique identifier of the entry.
 * @returns {string|null} - Returns the entity type identifier or null if the format is unknown or not provided.
 */
function guessEntityType(entry) {
	switch (entry.format) {
		case 'MANGA':
			switch (entry.countryOfOrigin) {
				case 'JP':
					return 'Q21198342';
				case 'KR':
					return 'Q74262765';
				case 'CN':
					return 'Q754669';
				default:
					return 'Q1004';
			}
		case 'ONE_SHOT':
			return 'Q21202185';
		case 'NOVEL':
			return 'Q104213567';
		case null:
			console.log(`No format for ${entry.id}`);
			return null;
		default:
			console.log(`Unknown format: ${entry.format} for ${entry.id}`);
			return null;
	}
}

/**
 * Converts an entity type identifier to a readable string.
 *
 * @param {string} type - The entity type identifier.
 * @returns {string|null} The readable entity type or null if the type is not recognized.
 */
function getReadableEntityType(type) {
	switch (type) {
		case 'Q21198342':
			return 'manga';
		case 'Q74262765':
			return 'manhwa';
		case 'Q754669':
			return 'manhua';
		case 'Q1004':
			return 'comic';
		case 'Q21202185':
			return 'one-shot manga';
		case 'Q104213567':
			return 'light novel';
		default:
			return null;
	}
}

export { entryCallback };
