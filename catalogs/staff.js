import { normalizeSpace } from './helpers.js';

const toPadded = (num, pad = 2) => String(num || 0).padStart(pad, '0');

function entryCallback(entry) {
	const { id, name, gender, bloodType, dateOfBirth, dateOfDeath, homeTown, yearsActive, primaryOccupations, siteUrl } = entry;
	// These fields can be null.
	const birth = dateOfBirth.year ? `${dateOfBirth.year}-${toPadded(dateOfBirth.month)}-${toPadded(dateOfBirth.day)}`.replace(/(-00)+$/, '') : null;
	const death = dateOfDeath.year ? `${dateOfDeath.year}-${toPadded(dateOfDeath.month)}-${toPadded(dateOfDeath.day)}`.replace(/(-00)+$/, '') : null;

	const description = [];
	if (name.native) {
		description.push(normalizeSpace(name.native));
	}
	if (primaryOccupations?.length) {
		description.push(primaryOccupations.join(', '));
	}
	if (homeTown) {
		description.push(`From ${normalizeSpace(homeTown)}`);
	}
	const descText = description.length ? description.join('. ') + '.' : null;
	return {
		ID: id,
		name: normalizeSpace(name.full || name.native),
		type: guessEntityType(entry),
		P1853: bloodTypeEntity(bloodType),
		P21: genderEntity(gender),
		born: birth,
		died: death,
		P2031: yearsActive[0],
		URL: siteUrl,
		description: descText,
	};
}

/**
 * Returns the entity ID for a given blood type.
 *
 * @param {string} bloodType - The blood type (e.g., 'A', 'B', 'AB', 'O').
 * @returns {string|null} The entity ID corresponding to the blood type, or null if the blood type is unknown.
 */
function bloodTypeEntity(bloodType) {
	switch (bloodType) {
		case 'A':
			return 'Q19831453';
		case 'B':
			return 'Q19831454';
		case 'AB':
			return 'Q19831455';
		case 'O':
			return 'Q19831451';
		default:
			return null;
	}
}

/**
 * Returns the Wikidata entity ID for a given gender.
 *
 * @param {string} gender - The gender to get the entity ID for. Expected values are 'male' or 'female'.
 * @returns {string|null} The Wikidata entity ID for the given gender, or null if the gender is unknown.
 */
function genderEntity(gender) {
	switch (gender?.toLowerCase()) {
		case 'male':
			return 'Q6581097';
		case 'female':
			return 'Q6581072';
		default:
			return null;
	}
}

/**
 * Guesses the entity type based on the provided entry.
 *
 * @param {Object} entry - The entry to analyze.
 * @param {string} entry.bloodType - The blood type of the entity.
 * @param {string} entry.gender - The gender of the entity.
 * @param {Object} entry.dateOfBirth - The date of birth of the entity.
 * @param {Object} entry.dateOfDeath - The date of death of the entity.
 * @param {Object} entry.name - The name of the entity.
 * @param {string} entry.name.first - The first name of the entity.
 * @param {string} entry.name.last - The last name of the entity.
 * @param {Array<string>} entry.primaryOccupations - The primary occupations of the entity.
 * @returns {string|null} - Returns 'Q5' if the entity is human, 'Q215380' if the entity is a band, or null if the entity type cannot be determined.
 */
function guessEntityType(entry) {
	const isBand = () => entry.primaryOccupations.some(occupation => occupation.match(/\bBand\s*$/i));
	const isPseudonym = () => entry.primaryOccupations.some(occupation => occupation.match(/\bPseudonym\b/i));
	const isChoir = () => entry.primaryOccupations.some(occupation => occupation.match(/\bChoir\b/i));
	const isOrchestra = () => entry.primaryOccupations.some(occupation => occupation.match(/\bOrchestra\b/i));
	const isIdolGroup = () => entry.primaryOccupations.some(occupation => occupation.match(/\bIdol\s*Group\b/i));
	const isGameStudio = () => entry.primaryOccupations.some(occupation => occupation.match(/\bGame\s*Studio\b/i));
	const isStudio = () => entry.primaryOccupations.some(occupation => occupation.match(/\bStudio\s*$/i));
	const isHuman = () => entry.bloodType || entry.gender || entry.homeTown ||
		Object.values(entry.dateOfBirth).some(num => !!num) || Object.values(entry.dateOfDeath).some(num => !!num) ||
		entry.primaryOccupations.some(occupation => {
			return occupation.match(/(\bMangaka|[eo]r|ist|ian|ant)\s*$/i) ||
				// Special cases
				['Manga', 'story', 'Coloring', 'DJ'].includes(occupation);
		}) ||
		// We assume organisations don't have both first and last names.
		(entry.name.first && entry.name.last);

	if (isBand()) {
		return 'Q215380';
	} else if (isPseudonym()) {
		return 'Q16017119';
	} else if (isChoir()) {
		return 'Q131186';
	} else if (isOrchestra()) {
		return 'Q42998';
	} else if (isIdolGroup()) {
		return 'Q108424578';
	} else if (isGameStudio()) {
		return 'Q210167';
	} else if (isStudio()) {
		return 'Q4830453';
	} else if (isHuman()) {
		return 'Q5';
	}
	return null;
}

export { entryCallback };
