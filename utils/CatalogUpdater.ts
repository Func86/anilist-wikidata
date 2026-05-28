import fs from 'fs';
import Papa from 'papaparse';
import * as core from '@actions/core';
import { updatedDiff } from 'deep-object-diff';

/**
 * Update the catalog by fetching data from a GraphQL API and writing it to a TSV file.
 */
class CatalogUpdater {
	dataNameMap = {
		anime: 'media',
		manga: 'media',
	};

	dataName: keyof typeof CatalogUpdater.prototype.dataNameMap;
	graphqlQuery: string;
	callback: Function;

	/**
	 * @param {string} dataName - The name of the data.
	 * @param {string} graphqlQuery - The GraphQL query string.
	 * @param {Function} callback - The callback function to handle the response.
	 */
	constructor(
		dataName: keyof typeof CatalogUpdater.prototype.dataNameMap,
		graphqlQuery: string,
		callback: Function
	) {
		this.dataName = dataName;
		this.graphqlQuery = graphqlQuery;
		this.callback = callback;
	}

	/**
	 * @param {string} updateType - The type of update to perform, `full` or `incremental`
	 * @param {number} [idOffset=0] - The ID offset to start from
	 */
	async update(updateType: string, idOffset: number = 0) {
		const variables: { perPage: number; idIn?: number[] } = {
			perPage: 50,
		};
		const idBucket = (idOffset: number, inclusive: boolean = false) => {
			return Array.from({ length: 50 * 4 }, (_, i) => idOffset + i + (inclusive ? 0 : 1));
		};

		const proxyPrefix = process.env.PROXY_PREFIX || '';
		const authHeaders = {};
		try {
			Object.assign(authHeaders, JSON.parse(process.env.PROXY_HEADERS || '{}'));
		} catch (error) {
			console.error('Failed to parse PROXY_HEADERS:', error);
		}

		const prevResult = Papa.parse<Record<string, string>>(
			fs.readFileSync(`anilist-${this.dataName}.tsv`, 'utf8'),
			{
				header: true,
				delimiter: '\t',
			}
		).data;
		const knownIds = prevResult.map(record => Number(record.id));
		const knownIdsSet = new Set(knownIds);

		let rawData: Record<string, { id: number, [key: string]: unknown }> = {};
		let updateUntilId: number | null = null;
		if (updateType === 'incremental' || idOffset > 0) {
			rawData = JSON.parse(fs.readFileSync(`./catalogs/${this.dataName}.json`, 'utf8'));
		}
		if (updateType === 'incremental') {
			const progressIds = Object.keys(rawData).map(Number).sort((a, b) => a - b);
			const newIds = progressIds.filter(id => !knownIdsSet.has(id));
			newIds.forEach(id => {
				knownIds.push(id);
				knownIdsSet.add(id);
			});
			knownIds.sort((a, b) => a - b);

			updateUntilId = progressIds[progressIds.length - 1];
			variables.idIn = idBucket(updateUntilId);
			console.log(`Last entry ID = ${updateUntilId}`);
		} else {
			variables.idIn = idBucket(idOffset > 0 ? idOffset : knownIds[0], true);
		}
		const maxKnownId = knownIds[knownIds.length - 1];

		let lastEntry: { id: number, updatedAt?: number, [key: string]: unknown } | null = null;
		let retries = 0, breakLoop = false;
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
					body: JSON.stringify({ query: this.graphqlQuery, variables }),
					signal: AbortSignal.timeout(30 * 1000), // 30 seconds timeout
				});

				if (!response.ok) {
					if (response.status === 429) {
						const waitFor = parseInt(response.headers.get('Retry-After') ?? '30', 10);
						console.log(`Rate limited, waiting ${waitFor} seconds...`);
						await new Promise(resolve => setTimeout(resolve, waitFor * 1000));
					} else {
						console.error(`Failed to fetch (HTTP ${response.status}):`, variables, await response.text());
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

				for (const entry of body.data.Page[this.dataNameMap[this.dataName] || this.dataName]) {
					if (updateUntilId && entry.id <= updateUntilId) {
						console.log('Reached last updated entry');
						breakLoop = true;
						break;
					}
					lastEntry = rawData[entry.id] = entry;
				}
				if (breakLoop) break;

				const pageInfo = body.data.Page.pageInfo;
				if (pageInfo.hasNextPage && lastEntry) {
					const logs = [
						`Last entry: ${lastEntry.id}`,
					];
					if (lastEntry.updatedAt) {
						logs.push(`updated at ${new Date(lastEntry.updatedAt * 1000).toISOString()}`);
					}
					console.log(logs.join(', '));
					variables.idIn = idBucket(lastEntry.id);
					continue;
				} else if (lastEntry && lastEntry.id <= maxKnownId) {
					const lastEntryId = lastEntry.id;
					variables.idIn = idBucket(knownIds.findIndex(id => id > lastEntryId), true);
					continue;
				} else if (updateType === 'incremental' && !breakLoop) {
					console.error(`No more pages to fetch: ${JSON.stringify({ pageInfo, variables })}`);
					core.warning('Unexpected end of query results');
				} else {
					breakLoop = true;
				}
			} catch (error) {
				if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
					console.log('Request timed out');
				} else {
					console.error('Error:', error);
					const message = error instanceof Error ? error.message : 'Unknown error';
					core.warning(`Error while fetching ${this.dataName}: ${message}`);
				}
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
			const message = error instanceof Error ? error.message : 'Unknown error';
			core.warning(`Error while processing ${this.dataName}: ${message}`);
		}
	}

	async checkCatalog(newCatalogRecords: Record<string, string>[], catalog: 'anime' | 'manga' | 'staff' | 'characters') {
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
			// This is the maximum limit (default is 100000), pagination is not needed
			// in the foreseeable future, unless the maximum is changed.
			limit: '1000000',
		}).toString();

		console.log(String(url));
		const response = await fetch(url, {
			headers: {
				'Accept': 'application/json',
				'User-Agent': 'AcgServiceBot/0.1 (https://github.com/Func86/anilist-wikidata)',
			},
		});
		if (!response.ok) {
			console.error(`Failed to fetch old catalog data (HTTP ${response.status})`);
			return;
		}

		const oldCatalogMap = this.parseOldCatalog(await response.json(), catalog);
		const newCatalogMap = Object.fromEntries(newCatalogRecords.map(record => [record.id, record]));
		console.log(`Old catalog has ${Object.keys(oldCatalogMap).length} entries, new catalog has ${Object.keys(newCatalogMap).length} entries`);

		const newlyDeleted = Object.keys(oldCatalogMap).filter(
			id => !newCatalogMap[id]
		);
		const addedOrModified = Object.keys(newCatalogMap).filter(
			id => !oldCatalogMap[id] || Object.keys(updatedDiff(oldCatalogMap[id], newCatalogMap[id])).length !== 0
		);

		const data: Record<string, string>[] = [];
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

	parseOldCatalog(records: Record<string, string>[], catalog: string) {
		const data: Record<string, Record<string, string>> = {};
		for (const record of records) {
			if (!record.external_id || isNaN(parseInt(record.external_id))) {
				console.error(`Invalid external ID: "${record.external_id}" for ${catalog} entry ${record.entry_id}`);
				continue;
			}
			if (record.entry_type === 'Q21441764') {
				continue;
			}
			const entry: Record<string, string> = {
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
