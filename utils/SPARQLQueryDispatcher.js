class SPARQLQueryDispatcher {
	constructor() {
		this.endpoint = 'https://query.wikidata.org/sparql';
	}

	/**
	 * Executes a SPARQL query against the Wikidata endpoint.
	 *
	 * @param {string} sparqlQuery - The SPARQL query to be executed.
	 * @returns {Promise<Object>} - The JSON response from the endpoint.
	 */
	async query(sparqlQuery) {
		const headers = {
			'Accept': 'application/sparql-results+json',
			'Content-Type': 'application/sparql-query',
			'User-Agent': 'AcgServiceBot/0.1 (https://github.com/Func86/anilist-wikidata)',
		};

		const response = await fetch(this.endpoint, {
			method: 'POST',
			headers,
			body: sparqlQuery,
		});
		try {
			return await response.clone().json();
		} catch (error) {
			console.error(`Status: ${response.status}`);
			console.error(await response.text());
			throw error;
		}
	}
}

export { SPARQLQueryDispatcher };
