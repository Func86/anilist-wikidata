/**
 * Formats a list of names into a readable string.
 *
 * @param {string[]} names - An array of names.
 * @returns {string} - A formatted string of names.
 */
function nameList(names) {
	const namesCopy = names.slice();
	const last = namesCopy.pop();
	if (namesCopy.length) {
		return `${namesCopy.join(', ')} and ${last}`;
	} else {
		return last;
	}
}

export { nameList };
