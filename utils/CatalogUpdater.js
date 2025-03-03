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
	 */
	constructor(dataName, graphqlQuery, callback) {
		this.dataName = dataName;
		this.graphqlQuery = graphqlQuery;
		this.callback = callback;
	}

	/**
	 * @param {string} updateType - The type of update to perform, `full` or `incremental`
	 * @param {number} [pageOffset=0] - The page offset to start from (0-indexed)
	 */
	async update(updateType, pageOffset = 0) {
		const variables = {
			page: pageOffset + 1,
		};
		const proxyPrefix = process.env.PROXY_PREFIX || '';
		const authHeaders = {};
		try {
			Object.assign(authHeaders, JSON.parse(process.env.PROXY_HEADERS || '{}'));
		} catch (error) {
			console.error('Failed to parse PROXY_HEADERS:', error);
		}

		let rawData = {}, updateUntil = null;
		if (this.dataNameMap[this.dataName]) {
			if (updateType === 'incremental') {
				variables.sort = 'UPDATED_AT_DESC';
				rawData = JSON.parse(fs.readFileSync(`./catalogs/${this.dataName}.json`, 'utf8'));
				updateUntil = Object.values(rawData).sort((a, b) => a.updatedAt - b.updatedAt)[0].updatedAt;
			} else {
				variables.sort = 'ID';
			}
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

				let breakLoop = false;
				for (const entry of body.data.Page[this.dataNameMap[this.dataName] || this.dataName]) {
					if (updateUntil && entry.updatedAt < updateUntil) {
						console.log(`Reached last updated entry at ${new Date(entry.updatedAt).toISOString()}`);
						break;
					}
					rawData[entry.id] = entry;
				}
				if (breakLoop) break;

				if (body.data.Page.pageInfo.hasNextPage) {
					const currentPage = body.data.Page.pageInfo.currentPage;
					console.log(`Continue to page offset ${currentPage}`);
					variables.page = currentPage + 1;
					// continue;
				}
			} catch (error) {
				console.error('Error:', error);
				core.warning(`Error while fetching ${this.dataName}: ${error.message}`);
			}
			break;
		}
		fs.writeFileSync(`./catalogs/${this.dataName}.json`, JSON.stringify(rawData, undefined, '\t'));

		// We absolutely don't want to error out and fail the workflow at this stage
		try {
			const data = [];
			for (const entry of Object.values(rawData).sort((a, b) => a.id - b.id)) {
				data.push(this.callback(entry));
			}

			fs.writeFileSync(`anilist-${this.dataName}.tsv`,
				Object.keys(data[0]).join('\t') + '\n' +
				data.map(row => Object.values(row).join('\t')).join('\n') + '\n'
			);
		} catch (error) {
			console.error('Error:', error);
			core.warning(`Error while processing ${this.dataName}: ${error.message}`);
		}
	}
}

export { CatalogUpdater };
