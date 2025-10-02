import fs from 'fs';
import Papa from 'papaparse';
import core from '@actions/core';
import { updatedDiff } from 'deep-object-diff';

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

				const pageInfo = body.data.Page.pageInfo;
				if (pageInfo.hasNextPage) {
					console.log(
						`Last entry: ${lastEntry.id},`,
						lastEntry.updatedAt ? `upddated at ${new Date(lastEntry.updatedAt * 1000).toISOString()},` : '',
						`next page offset = ${pageInfo.currentPage}`
					);
					variables.page = pageInfo.currentPage + 1;
					continue;
				} else if (!breakLoop) {
					console.error(`No more pages to fetch: ${JSON.stringify(pageInfo)}`);
					core.warning('Unexpected end of query results');
				}
			} catch (error) {
				console.error('Error:', error);
				core.warning(`Error while fetching ${this.dataName}: ${error.message}`);
				if (retries++ < 3) {
					console.log(`Retrying in ${retrySleep[retries - 1]} seconds...`);
					await new Promise(resolve => setTimeout(resolve, retrySleep[retries - 1] * 1000));
					continue;
				}
			}
			break;
		}
		fs.writeFileSync(`./catalogs/${this.dataName}.json`, JSON.stringify(rawData, undefined, '\t'));

		// Didn't finish, don't mess up the catalog
		if (!breakLoop) {
			return;
		}

		// We absolutely don't want to error out and fail the workflow at this stage
		try {
			const data = [];
			for (const entry of Object.values(rawData).sort((a, b) => a.id - b.id)) {
				data.push(this.callback(entry));
			}

			fs.writeFileSync(`anilist-${this.dataName}.tsv`, Papa.unparse(data, {
				delimiter: '\t',
				newline: '\n',
			}));

			await this.checkCatalog(data, this.dataName);
		} catch (error) {
			console.error('Error:', error);
			core.warning(`Error while processing ${this.dataName}: ${error.message}`);
		}
	}

	async checkCatalog(newCatalogRecords, catalog) {
		const catalogIdMap = {
			'anime': '4086',
			'manga': '5745',
			'staff': '5714',
			'characters': '5911',
		};
		const url = new URL('https://mix-n-match.toolforge.org/api.php');
		url.search = new URLSearchParams({
			query: 'download2',
			catalogs: catalogIdMap[catalog],
			columns: JSON.stringify({
				exturl: 1,
				username: 0,
				aux: 1,
				dates: 1,
				location: 0,
				multimatch: 0
			}),
			hidden: JSON.stringify({
				any_matched: 0,
				firmly_matched: 0,
				user_matched: 0,
				unmatched: 0,
				automatched: 0,
				name_date_matched: 0,
				aux_matched: 0,
				no_multiple: 0
			}),
			format: 'json',
		});

		console.log(String(url));
		const response = await fetch(url);
		const oldCatalogMap = this.parseOldCatalog(await response.json(), catalog);
		const newCatalogMap = Object.fromEntries(newCatalogRecords.map(record => [record.id, record]));
		console.log(`Old catalog has ${Object.keys(oldCatalogMap).length} entries, new catalog has ${Object.keys(newCatalogMap).length} entries`);

		const newlyDeleted = Object.keys(oldCatalogMap).filter(
			id => !newCatalogMap[id] && oldCatalogMap[id].type !== 'Q21441764'
		);
		const addedOrModified = Object.keys(newCatalogMap).filter(
			id => !oldCatalogMap[id] || Object.keys(updatedDiff(oldCatalogMap[id], newCatalogMap[id])).length !== 0
		);

		const data = [];
		for (const id of newlyDeleted) {
			data.push({
				id,
				name: oldCatalogMap[id].name,
				type: 'Q21441764', // withdrawn identifier value
				description: '[withdrawn identifier value]',
			});
		}
		for (const id of addedOrModified) {
			data.push(newCatalogMap[id]);
		}

		fs.writeFileSync(`anilist-${catalog}-update.tsv`, Papa.unparse(data, {
			delimiter: '\t',
			newline: '\n',
			columns: Object.keys(newCatalogRecords[0]),
		}));
	}

	parseOldCatalog(records, catalog) {
		const data = {};
		for (const record of records) {
			if (!record.external_id || isNaN(record.external_id)) {
				console.error(`Invalid external ID: "${record.external_id}" for ${catalog} entry ${record.entry_id}`);
				continue;
			}
			const entry = {
				id: record.external_id,
				name: record.name,
				type: record.entry_type,
				url: record.external_url,
				description: record.description,
			};
			if (record.born) {
				entry.born = record.born;
			}
			if (record.died) {
				entry.died = record.died;
			}
			if (record.auxiliary_data) {
				const aux = record.auxiliary_data.split('|').map(s => s.match(/^\{`(P\d+)`,`(Q?[^`]+)`,`[01]`\}$/));
				for (const match of aux) {
					if (match) {
						entry[match[1]] = match[2];
					} else {
						console.error(`Invalid auxiliary data: "${record.auxiliary_data}" for ${catalog} entry ${record.entry_id}`);
					}
				}
			}
			data[record.external_id] = entry;
		}

		return data;
	}
}

export { CatalogUpdater };
