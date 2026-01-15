import { normalizeSpace } from './helpers.js';

function entryCallback(entry) {
	const description = [];
	if (entry.name.native) {
		description.push(normalizeSpace(entry.name.native));
	}
	const nodeWithDate = entry.media.nodes.find(node => node.startDate?.year);
	const firstNode = nodeWithDate || entry.media.nodes.sort((a, b) => a.id - b.id)[0];
	if (firstNode) {
		const descTitle = firstNode.title.english || firstNode.title.romaji;
		if (descTitle) {
			description.push(`Character in ${normalizeSpace(descTitle)}`);
		} else {
			console.log('Missing title:', firstNode);
		}
	}
	return {
		id: String(entry.id),
		name: normalizeSpace(entry.name.full || entry.name.alternative[0] || '(empty)'),
		type: guessEntityType(entry) || '',
		url: entry.siteUrl,
		description: description.join('. '),
	};
}

function guessEntityType(entry) {
	// Assuming that the character with a blood type is a human.
	if (['A', 'B', 'AB', 'O'].includes(entry.bloodType)) {
		return 'Q15632617';
	}
	// The list is sorted by start date, and we only need the first entry.
	// But iterate through all of them in case some fields are missing.
	for (const media of entry.media.nodes) {
		if (media.type === 'ANIME') {
			if (media.countryOfOrigin === 'JP') {
				return 'Q80447738';
			} else {
				return 'Q15711870';
			}
		}
		if (media.format === 'MANGA' || media.format === 'ONE_SHOT') {
			if (media.countryOfOrigin === 'JP') {
				return 'Q87576284';
			} else {
				return 'Q1114461';
			}
		}
		if (media.format === 'NOVEL') {
			return 'Q3658341';
		}
	}
	return null;
}

export { entryCallback };
