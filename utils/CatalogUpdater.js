import fs from 'fs';
import Papa from 'papaparse';
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

		let rawData = {};
		const updateUntil = {
			id: null,
			updatedAt: null,
		};
		if (updateType === 'incremental') {
			rawData = JSON.parse(fs.readFileSync(`./catalogs/${this.dataName}.json`, 'utf8'));
			if (this.dataNameMap[this.dataName]) {
				variables.sort = 'UPDATED_AT_DESC';
				updateUntil.updatedAt = Object.values(rawData).sort((a, b) => b.updatedAt - a.updatedAt)[0].updatedAt;
				console.log(`Last updated entry at ${new Date(updateUntil.updatedAt * 1000).toISOString()}`);
			} else {
				variables.sort = 'ID_DESC';
				updateUntil.id = Object.keys(rawData).sort((a, b) => b - a)[0];
				console.log(`Last entry ID = ${updateUntil.id}`);
			}
		} else {
			variables.sort = 'ID';
		}

		let lastEntry = null, retries = 0;
		const retrySleep = [ 5, 10, 30, 60 ];
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

				if (!response.ok) {
					if (response.status === 429) {
						const waitFor = parseInt(response.headers.get('Retry-After'), 10) || 30;
						console.log(`Rate limited, waiting ${waitFor} seconds...`);
						await new Promise(resolve => setTimeout(resolve, waitFor * 1000));
					} else {
						console.error(`Failed to fetch (HTTP ${response.status}):`, variables);
						if (retries++ > 3) {
							core.warning(`Failed to fetch after 3 retries: HTTP ${response.status}`);
							break;
						}
						console.log(`Retrying in ${retrySleep[retries - 1]} seconds...`);
						await new Promise(resolve => setTimeout(resolve, retrySleep[retries - 1] * 1000));
					}
					continue;
				}
				retries = 0;

				const body = await response.json();
				if (!body.data?.Page?.[this.dataNameMap[this.dataName] || this.dataName]) {
					console.error('Invalid response:', body);
					core.warning(`Invalid response for ${this.dataName}: ${JSON.stringify(body)}`);
					break;
				}

				let breakLoop = false;
				for (const entry of body.data.Page[this.dataNameMap[this.dataName] || this.dataName]) {
					if ((updateUntil.updatedAt && entry.updatedAt < updateUntil.updatedAt) ||
						(updateUntil.id && entry.id <= updateUntil.id)
					) {
						console.log('Reached last updated entry');
						breakLoop = true;
						break;
					}
					lastEntry = rawData[entry.id] = entry;
				}
				if (breakLoop) break;

				if (body.data.Page.pageInfo.hasNextPage) {
					const currentPage = body.data.Page.pageInfo.currentPage;
					console.log(
						`Last entry: ${lastEntry.id},`,
						lastEntry.updatedAt ? `upddated at ${new Date(lastEntry.updatedAt * 1000).toISOString()},` : '',
						`next page offset = ${currentPage}`
					);
					variables.page = currentPage + 1;
					continue;
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

			fs.writeFileSync(`anilist-${this.dataName}.tsv`, Papa.unparse(data, { delimiter: '\t' }));
		} catch (error) {
			console.error('Error:', error);
			core.warning(`Error while processing ${this.dataName}: ${error.message}`);
		}
	}
}

export { CatalogUpdater };
