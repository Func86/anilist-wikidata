class SPARQLQueryDispatcher {
	constructor(endpoint = 'https://query.wikidata.org/sparql') {
		this.endpoint = endpoint;
	}

	/**
	 * Executes a SPARQL query against the Wikidata endpoint.
	 *
	 * @param {string} sparqlQuery - The SPARQL query to be executed.
	 * @returns {Promise<Object>} - The JSON response from the endpoint.
	 */
	async query(sparqlQuery) {
		const userAgent = 'AcgServiceBot/0.1 (https://github.com/Func86/anilist-wikidata)';
		const headers = {
			'Accept': 'application/sparql-results+json',
			'Accept-Encoding': 'gzip',
			'Content-Type': 'application/sparql-query',
			'User-Agent': userAgent,
			// Workaround: https://phabricator.wikimedia.org/T402959#11558060
			'Api-User-Agent': userAgent,
		};

		let retries = 0;
		const retrySleep = [ , 10, 30, 60 ];
		while (retries < 3) {
			const response = await fetch(this.endpoint, {
				method: 'POST',
				headers,
				body: sparqlQuery,
			});
			if (response.ok) {
				return await response.json();
			}

			const responseText = await response.text();
			const isTimeout = response.status === 500 && responseText.includes('java.util.concurrent.TimeoutException');
			const state = isTimeout ? 'timed out' : 'failed';
			if (++retries < 3) {
				console.log(`Query ${state}, retrying in ${retrySleep[retries]} seconds...`);
				await new Promise(resolve => setTimeout(resolve, retrySleep[retries] * 1000));
				continue;
			} else {
				console.error(`Query ${state} after 3 retries:`, response.status, responseText);
				throw new Error(`Query ${state} after 3 retries: ${response.status}`);
			}
		}
	}
}

export { SPARQLQueryDispatcher };
