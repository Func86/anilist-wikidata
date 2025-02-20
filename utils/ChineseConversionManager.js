import { langMap, variantCodes, langFallback } from './lang-helpers.js';

class ChineseConversionManager {
	titles = {};
	variantMap = {};

	/**
	 * @param {ChineseConversionProvider} provider
	 */
	constructor(provider) {
		this.provider = provider;
	}

	/**
	 * Processes and queues language mappings for a given ID.
	 *
	 * @param {string} id - The unique identifier for the language mapping.
	 * @param {Object} existingMap - Key-value pairs where the key is a language code and the value is the corresponding mapping.
	 *
	 * @example
	 * const existingMap = {
	 *   'zh': 'Chinese Title',
	 *   'zh-hant': 'Traditional Chinese Title',
	 * };
	 * queue('12345', existingMap);
	 */
	queue(id, existingMap) {
		const existing = Object.keys(existingMap);
		const lacking = variantCodes.filter((value) => !existing.includes(value));
		this.variantMap[id] = { ...existingMap };

		if (lacking.length) {
			this.titles[id] = {};
			lacking.forEach((lang) => {
				const fallbacks = langFallback[lang].filter((value) => existing.includes(value));
				if (fallbacks.length === 0) {
					console.warn({ id, map: existingMap, _: 'The Wikidata entry should be fixed.' });
				}
				const fallbackLang = fallbacks[0] ?? existing[0];
				this.titles[id][lang] = existingMap[fallbackLang];
			});
		}

		// Removes titles that are the same as their fallback
		const removed = [];
		for (const lang of variantCodes.toReversed()) {
			for (const fallback of langFallback[lang]) {
				if (!this.variantMap[id][fallback]) {
					continue;
				}
				// If the title is the same as the fallback one, no need to store it
				if (this.variantMap[id][lang] === this.variantMap[id][fallback]) {
					delete this.variantMap[id][lang];
					removed.push(lang);
				}
				break;
			}
		}
		if (removed.length) {
			this.variantMap[id]._ = { removed };
		}
	}

	async getConvertedMap() {
		const variantMap = this.variantMap;
		if (Object.keys(this.titles).length === 0) {
			this.variantMap = {};

			return variantMap;
		}

		const convertedMap = await this.provider.convert(this.titles);
		for (const id in variantMap) {
			const added = [];
			for (const lang of Object.keys(convertedMap[id] || {})) {
				for (const fallback of langFallback[lang]) {
					if (!variantMap[id][fallback]) {
						continue;
					}
					// If the title is not the same as the fallback one, store it
					if (convertedMap[id][lang] !== variantMap[id][fallback]) {
						variantMap[id][lang] = convertedMap[id][lang];
						added.push(lang);
					}
					break;
				}
			}
			if (added.length) {
				variantMap[id]._ ??= {};
				variantMap[id]._.added = added;
			}
		}

		// Clear the queue
		this.titles = {};
		this.variantMap = {};

		return variantMap;
	}
}

/**
 * Conversion Provider implementation with MediaWiki API
 */
class ChineseConversionProvider {
	constructor(awaiter, apiEndpoint = 'https://moegirl.icu/api.php') {
		this.awaiter = awaiter;
		this.apiEndpoint = apiEndpoint;
	}

	async convertBatch(titles) {
		const body = {
			"action": "parse",
			"format": "json",
			"uselang": "zh",
			"text": JSON.stringify(titles),
			"prop": "text",
			"wrapoutputclass": "",
			"disablelimitreport": 1,
			"disableeditsection": 1,
			"contentmodel": "wikitext",
			"templatesandboxtitle": "Module:Nowiki",
			"templatesandboxtext": "return { nowiki = function(frame) return mw.text.nowiki(frame.args[1]) end }",
			"templatesandboxcontentmodel": "Scribunto",
			"formatversion": 2,
		};
		const response = await fetch(this.apiEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Accept': 'application/json',
			},
			body: new URLSearchParams(body),
		});
		try {
			const respBody = await response.clone().json();
			return JSON.parse(respBody.parse.text.match(/^<p>(\{.+\})\s*<\/p>[\s\S]*$/)[1].replaceAll('&amp;', '&'));
		} catch (error) {
			console.log(response.status);
			console.error(await response.text());
			throw error;
		}
	}

	async convert(titles) {
		const coversions = {};
		for (const id in titles) {
			coversions[id] = {};
			for (const lang in titles[id]) {
				const source = titles[id][lang];
				coversions[id][lang] = `<langconvert from=zh to=${langMap[lang]}>{{#invoke:Nowiki|nowiki|${source}}}</langconvert>`;
			}
		}

		let pos = 0;
		const batchSize = 800;
		const batches = [];
		while (pos < Object.keys(coversions).length) {
			const batch = {};
			for (const id of Object.keys(coversions).slice(pos, pos + batchSize)) {
				batch[id] = coversions[id];
			}
			batches.push(
				this.awaiter.do(
					`ChineseMappingManager: langconvert - (${pos}, ${pos + batchSize})`,
					async () => this.convertBatch(batch)
				)
			);
			pos += batchSize;
		}

		const converted = {};
		for (const batch of batches) {
			Object.assign(converted, await batch);
		}

		return converted;
	}
}

export { ChineseConversionManager, ChineseConversionProvider };
