const langMap = {
	"zh-hans": "zh-Hans", "zh-hant": "zh-Hant",
	"zh-cn": "zh-Hans-CN", "zh-sg": "zh-Hans-SG", "zh-my": "zh-Hans-MY",
	"zh-tw": "zh-Hant-TW", "zh-hk": "zh-Hant-HK", "zh-mo": "zh-Hant-MO"
};
const variantCodes = Object.keys(langMap);
const langCodes = [ 'zh', ...variantCodes ];

/**
 * Convert BCP 47 language tag to MediaWiki language code
 *
 * @param {string} bcp47Lang
 */
function langFromBcp47(bcp47Lang) {
	return Object.keys(langMap).find((key) => langMap[key] === bcp47Lang);
}

const langFallback = {
	"zh": ["zh-hans", "zh-hant", "zh-cn", "zh-tw", "zh-hk", "zh-sg", "zh-mo", "zh-my"],
	"zh-hans": ["zh-cn", "zh-sg", "zh-my", "zh"],
	"zh-hant": ["zh-tw", "zh-hk", "zh-mo", "zh"],
	"zh-cn": ["zh-hans", "zh-sg", "zh-my", "zh"],
	"zh-sg": ["zh-my", "zh-hans", "zh-cn", "zh"],
	"zh-my": ["zh-sg", "zh-hans", "zh-cn", "zh"],
	"zh-tw": ["zh-hant", "zh-hk", "zh-mo", "zh"],
	"zh-hk": ["zh-mo", "zh-hant", "zh-tw", "zh"],
	"zh-mo": ["zh-hk", "zh-hant", "zh-tw", "zh"]
};

export {
	langMap,
	langCodes,
	variantCodes,
	langFallback,
	langFromBcp47
};
