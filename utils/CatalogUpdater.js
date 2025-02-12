import fs from 'node:fs';

class CatalogUpdater {
	dataNameMap = {
		anime: 'media',
		manga: 'media',
	};

	/**
	 * @param {string} dataName - The name of the data.
	 * @param {string} graphqlQuery - The GraphQL query string.
	 * @param {string[]} dataHeaders - The headers for the data request.
	 * @param {Function} callback - The callback function to handle the response.
	 * @param {number} [pageOffset=0] - The offset for pagination (default is 0).
	 */
	constructor(dataName, graphqlQuery, dataHeaders, callback, pageOffset = 0) {
		this.dataName = dataName;
		this.graphqlQuery = graphqlQuery;
		this.dataHeaders = dataHeaders;
		this.callback = callback;
		this.pageOffset = pageOffset;
	}

	async update() {
		const filePath = `anilist-${this.dataName}.csv`;
		if (this.pageOffset === 0) {
			fs.writeFileSync(filePath, this.dataHeaders.join('\t') + '\n');
		}

		const variables = {
			page: this.pageOffset + 1,
		};
		const authHeaders = JSON.parse(process.env.PROXY_HEADERS || '{}');

		while (true) {
			try {
				const response = await fetch(process.env.PROXY_PREFIX + 'https://graphql.anilist.co', {
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
	
				const data = [];
				for (const entry of body.data.Page[this.dataNameMap[this.dataName] || this.dataName]) {
					data.push(this.callback(entry));
				}
	
				// Append the data to the file, so we can resume from where we left off.
				fs.appendFileSync(filePath, data.map(row => row.join('\t')).join('\n') + '\n');
	
				if (body.data.Page.pageInfo.hasNextPage) {
					const nextOffset = body.data.Page.pageInfo.currentPage;
					console.log(`Continue to page offset ${nextOffset}`);
					variables.page = nextOffset + 1;
					continue;
				}
			} catch (error) {
				console.error('Error:', error);
			}
			break;
		}
	}
}

export { CatalogUpdater };
