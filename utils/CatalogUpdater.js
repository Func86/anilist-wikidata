import fs from 'node:fs';
import core from '@actions/core';

/**
 * Update the catalog by fetching data from a GraphQL API and writing it to a TSV file.
 */
class CatalogUpdater {
	dataNameMap = {
		anime: 'media',
		manga: 'media',
	};

	/**
	 * @param {string} dataName - The name of the data.
	 * @param {string} graphqlQuery - The GraphQL query string.
	 * @param {Function} callback - The callback function to handle the response.
	 * @param {number} [pageOffset=0] - The offset for pagination (default is 0).
	 */
	constructor(dataName, graphqlQuery, callback, pageOffset = 0) {
		this.dataName = dataName;
		this.graphqlQuery = graphqlQuery;
		this.callback = callback;
		this.pageOffset = pageOffset;
	}

	async update() {
		const filePath = `anilist-${this.dataName}.tsv`;
		const variables = {
			page: this.pageOffset + 1,
		};
		const proxyPrefix = process.env.PROXY_PREFIX || '';
		const authHeaders = {};
		try {
			Object.assign(authHeaders, JSON.parse(process.env.PROXY_HEADERS || '{}'));
		} catch (error) {
			console.error('Failed to parse PROXY_HEADERS:', error);
		}

		while (true) {
			try {
				const response = await fetch(proxyPrefix + 'https://graphql.anilist.co', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Accept': 'application/json',
						...authHeaders
					},
					body: JSON.stringify({ query: this.graphqlQuery, variables })
				});
				if (!response.ok && response.status === 429) {
					const waitFor = parseInt(response.headers.get('Retry-After'), 10) || 30;
					console.log(`Rate limited, waiting ${waitFor} seconds...`);
					await new Promise(resolve => setTimeout(resolve, waitFor * 1000));
					continue;
				}
				const body = await response.json();
				if (!body.data?.Page?.[this.dataNameMap[this.dataName] || this.dataName]) {
					console.error('Invalid response:', body);
					core.warning(`Invalid response for ${this.dataName}: ${JSON.stringify(body)}`);
					break;
				}

				const rawData = {}, data = [];
				for (const entry of body.data.Page[this.dataNameMap[this.dataName] || this.dataName]) {
					rawData[entry.id] = entry;
					data.push(this.callback(entry));
				}

				// Append the data to the file, so we can resume from where we left off.
				const currentPage = body.data.Page.pageInfo.currentPage;
				if (currentPage === 1) {
					fs.writeFileSync(filePath, Object.keys(data[0]).join('\t') + '\n');
					fs.writeFileSync(`./catalogs/${this.dataName}.json`, JSON.stringify(rawData, undefined, '\t').slice(0, -1).trimEnd());
				} else {
					fs.appendFileSync(`./catalogs/${this.dataName}.json`, ',\n' + JSON.stringify(rawData, undefined, '\t').slice(1, -1).trimEnd());
				}
				fs.appendFileSync(filePath, data.map(row => Object.values(row).join('\t')).join('\n') + '\n');

				if (body.data.Page.pageInfo.hasNextPage) {
					console.log(`Continue to page offset ${currentPage}`);
					variables.page = currentPage + 1;
					continue;
				} else {
					fs.appendFileSync(`./catalogs/${this.dataName}.json`, '\n}');
				}
			} catch (error) {
				console.error('Error:', error);
				core.warning(`Error while fetching ${this.dataName}: ${error.message}`);
			}
			break;
		}
	}
}

export { CatalogUpdater };
