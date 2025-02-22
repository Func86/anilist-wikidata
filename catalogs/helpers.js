/**
 * Normalizes whitespace in a string by replacing multiple spaces with a single space and trimming leading/trailing spaces.
 * @param {string} str - The string to normalize.
 * @returns {string|undefined} The normalized string, or undefined if the input is nullish.
 */
function normalizeSpace(str) {
	return str?.replace(/\s+/g, ' ').trim();
}

/**
 * Formats a list of names into a readable string.
 *
 * @param {string[]} names - An array of names.
 * @param {boolean} [normalize=true] - Whether to normalize the names by removing extra whitespace.
 * @returns {string} - A formatted string of names.
 */
function nameList(names, normalize = true) {
	const namesCopy = names.map(name => normalize ? normalizeSpace(name) : name);
	const last = namesCopy.pop();
	if (namesCopy.length) {
		return `${namesCopy.join(', ')} and ${last}`;
	} else {
		return last;
	}
}

export { nameList, normalizeSpace };
