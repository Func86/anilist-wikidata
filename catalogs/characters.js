const dataHeaders = ['ID', 'Name', 'type', 'URL', 'description'];

function entryCallback(entry) {
	const description = [];
	if (entry.name.native) {
		description.push(entry.name.native);
	}
	if (entry.media.nodes.length) {
		const title = entry.media.nodes[0].title;
		const descTitle = title.english || title.romaji;
		if (descTitle) {
			description.push(`Character in ${descTitle}`);
		} else {
			console.log('Missing title:', entry.media.nodes[0]);
		}
	}
	return [entry.id, entry.name.full, guessEntityType(entry), entry.siteUrl, description.join('. ')];
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

export { dataHeaders, entryCallback };
