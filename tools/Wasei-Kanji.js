import waseiKanji from './Wasei-Kanji.json' with { type: 'json' };

/**
 * Replaces multiple substrings in a given string based on a replacement map.
 *
 * @param {string} str - The original string where replacements will be made.
 * @param {Object} replaceMap - An object where keys are substrings to be replaced and values are their replacements.
 * @returns {string} - The modified string with all replacements made.
 */
function replaceBulk(str, replaceMap) {
	const regex = Object.keys(replaceMap).map(
		// Escape special characters for regex
		(key) => key.replace(/([-[\]{}()*+?.\\^$|#,])/g, '\\$1')
	);
	return str.replace(new RegExp(regex.join('|'), 'g'), matched => replaceMap[matched]);
}

/**
 * Replaces Wasei Kanji characters in a given text with their corresponding replacements.
 *
 * @param {string} text - The text in which Wasei Kanji characters will be replaced.
 * @returns {string} - The modified text with Wasei Kanji characters replaced.
 */
function replaceWaseiKanji(text) {
	return replaceBulk(text, waseiKanji);
}

export { replaceWaseiKanji };
