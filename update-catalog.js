import fs from 'node:fs';

const graphqlQuery = `\
query Staff($page: Int) {
  Page(page: $page) {
    pageInfo {
      currentPage
      hasNextPage
      perPage
    }
    staff {
      id
      name {
        native
        full
        first
        last
      }
      gender
      bloodType
      dateOfBirth {
        year
        month
        day
      }
      dateOfDeath {
        day
        month
        year
      }
      homeTown
      yearsActive
      primaryOccupations
      siteUrl
    }
  }
}`;

const pageOffset = 0;
const variables = {
	page: pageOffset + 1,
};

const authHeaders = JSON.parse(process.env.PROXY_HEADERS || '{}');
const normalizeSpace = str => str?.replace(/\s{2,}/g, ' ').trim();
const toPadded = (num, pad = 2) => String(num || 0).padStart(pad, '0');
while (true) {
	const response = await fetch(process.env.PROXY_PREFIX + 'https://graphql.anilist.co', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			...authHeaders
		},
		body: JSON.stringify({ query: graphqlQuery, variables })
	});
	if (!response.ok && response.status === 429) {
		const waitFor = response.headers.get('Retry-After') ?? 30;
		console.log(`Rate limited, waiting ${waitFor} seconds...`);
		await new Promise(resolve => setTimeout(resolve, waitFor * 1000));
		continue;
	}
	const body = await response.json();

	const data = [];
	for (const entry of body.data.Page.staff) {
		const { id, name, gender, bloodType, dateOfBirth, dateOfDeath, homeTown, yearsActive, primaryOccupations, siteUrl } = entry;
		// These fields can be null.
		const birth = dateOfBirth.year ? `${dateOfBirth.year}-${toPadded(dateOfBirth.month)}-${toPadded(dateOfBirth.day)}`.replace(/(-00)+$/, '') : null;
		const death = dateOfDeath.year ? `${dateOfDeath.year}-${toPadded(dateOfDeath.month)}-${toPadded(dateOfDeath.day)}`.replace(/(-00)+$/, '') : null;

		const description = [];
		if (name.native) {
			description.push(normalizeSpace(name.native));
		}
		if (primaryOccupations?.length) {
			description.push(primaryOccupations.join(', '));
		}
		if (homeTown) {
			description.push(`From ${normalizeSpace(homeTown)}`);
		}
		const descText = description.length ? description.join('. ') + '.' : null;
		data.push([id, normalizeSpace(name.full), guessEntityType(entry), bloodTypeEntity(bloodType), genderEntity(gender), birth, death, yearsActive[0], siteUrl, descText]);
	}

	// Append the data to the file, so we can resume from where we left off.
	const fileName = `anilist-staff.csv`;
	if (!fs.existsSync(fileName)) {
		fs.writeFileSync(fileName, 'ID	name	type	P1853	P21	born	died	P2031	URL	description\n');
	}
	fs.appendFileSync(fileName, data.map(row => row.join('\t')).join('\n') + '\n');

	if (body.data.Page.pageInfo.hasNextPage) {
		const nextOffset = body.data.Page.pageInfo.currentPage;
		console.log(`Continue to page offset ${nextOffset}`);
		variables.page = nextOffset + 1;
		continue;
	}
	break;
}

/**
 * Returns the entity ID for a given blood type.
 *
 * @param {string} bloodType - The blood type (e.g., 'A', 'B', 'AB', 'O').
 * @returns {string|null} The entity ID corresponding to the blood type, or null if the blood type is unknown.
 */
function bloodTypeEntity(bloodType) {
	switch (bloodType) {
		case 'A':
			return 'Q19831453';
		case 'B':
			return 'Q19831454';
		case 'AB':
			return 'Q19831455';
		case 'O':
			return 'Q19831451';
		default:
			return null;
	}
}

/**
 * Returns the Wikidata entity ID for a given gender.
 *
 * @param {string} gender - The gender to get the entity ID for. Expected values are 'male' or 'female'.
 * @returns {string|null} The Wikidata entity ID for the given gender, or null if the gender is unknown.
 */
function genderEntity(gender) {
	switch (gender?.toLowerCase()) {
		case 'male':
			return 'Q6581097';
		case 'female':
			return 'Q6581072';
		default:
			return null;
	}
}

/**
 * Guesses the entity type based on the provided entry.
 *
 * @param {Object} entry - The entry to analyze.
 * @param {string} entry.bloodType - The blood type of the entity.
 * @param {string} entry.gender - The gender of the entity.
 * @param {Object} entry.dateOfBirth - The date of birth of the entity.
 * @param {Object} entry.dateOfDeath - The date of death of the entity.
 * @param {Object} entry.name - The name of the entity.
 * @param {string} entry.name.first - The first name of the entity.
 * @param {string} entry.name.last - The last name of the entity.
 * @param {Array<string>} entry.primaryOccupations - The primary occupations of the entity.
 * @returns {string|null} - Returns 'Q5' if the entity is human, 'Q215380' if the entity is a band, or null if the entity type cannot be determined.
 */
function guessEntityType(entry) {
	const isHuman = entry.bloodType || entry.gender ||
		Object.values(entry.dateOfBirth).filter(num => !!num) || Object.values(entry.dateOfDeath).filter(num => !!num)
		// Bands etc. don't have first/last names, so we can't assume they're human.
		|| entry.name.first || entry.name.last;

	if (isHuman) {
		return 'Q5';
	} else if (entry.primaryOccupations?.includes('Band')) {
		return 'Q215380';
	}
	return null;
}
