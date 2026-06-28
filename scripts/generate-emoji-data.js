#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const path = require('path');

const EMOJI_TEST_URL = 'https://unicode.org/Public/emoji/latest/emoji-test.txt';
const CLDR_ANNOTATIONS_URL = 'https://raw.githubusercontent.com/unicode-org/cldr/main/common/annotations/en.xml';
const GEMOJI_URL = 'https://raw.githubusercontent.com/github/gemoji/master/db/emoji.json';
const OUTPUT = path.resolve(__dirname, '..', 'emojiData.js');

function fetchText(url) {
    return new Promise((resolve, reject) => {
        https.get(url, response => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
                reject(new Error(`Failed to fetch ${url}: HTTP ${response.statusCode}`));
                response.resume();
                return;
            }

            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                body += chunk;
            });
            response.on('end', () => resolve(body));
        }).on('error', reject);
    });
}

function decodeXmlEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function normalizeToken(value) {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function addKeyword(keywords, value) {
    const normalized = normalizeToken(value);
    if (!normalized)
        return;

    const parts = normalized.split(/[^a-z0-9+]+/).filter(Boolean);
    for (const part of parts)
        keywords.add(part);

    const compact = parts.join('');
    if (compact.length > 1)
        keywords.add(compact);
}

function keywordsFromValues(values) {
    const keywords = new Set();
    for (const value of values)
        addKeyword(keywords, value);
    return [...keywords];
}

function parseEmojiTest(source) {
    const emoji = [];
    let category = '';
    let subcategory = '';

    for (const line of source.split('\n')) {
        const group = line.match(/^# group: (.+)$/);
        if (group) {
            category = group[1];
            continue;
        }

        const subgroup = line.match(/^# subgroup: (.+)$/);
        if (subgroup) {
            subcategory = subgroup[1];
            continue;
        }

        if (!line.includes('; fully-qualified'))
            continue;

        const match = line.match(/#\s*(\S+)\s+E[0-9.]+\s+(.+)$/);
        if (!match)
            continue;

        const [, glyph, name] = match;
        emoji.push({
            emoji: glyph,
            name,
            category,
            subcategory,
            keywords: keywordsFromValues([name]),
        });
    }

    return emoji;
}

function parseCldrAnnotations(source) {
    const annotations = new Map();
    const annotationRegex = /<annotation cp="([^"]+)"(?: type="tts")?>(.*?)<\/annotation>/g;
    let match;

    while ((match = annotationRegex.exec(source)) !== null) {
        const [, encodedGlyph, encodedText] = match;
        const glyph = decodeXmlEntities(encodedGlyph);
        const text = decodeXmlEntities(encodedText);
        const values = text.split('|').map(item => item.trim()).filter(Boolean);

        if (!annotations.has(glyph))
            annotations.set(glyph, []);

        annotations.get(glyph).push(...values);
    }

    return annotations;
}

function parseGemojiAliases(source) {
    const aliases = new Map();

    for (const item of JSON.parse(source)) {
        if (!item.emoji)
            continue;

        aliases.set(item.emoji, [
            ...(item.aliases || []),
            ...(item.tags || []),
        ]);
    }

    return aliases;
}

function mergeKeywords(entry, ...keywordGroups) {
    const keywords = new Set(entry.keywords);

    for (const group of keywordGroups) {
        for (const value of group || [])
            addKeyword(keywords, value);
    }

    entry.keywords = [...keywords];
}

async function main() {
    const [emojiTest, cldrAnnotations, gemoji] = await Promise.all([
        fetchText(EMOJI_TEST_URL),
        fetchText(CLDR_ANNOTATIONS_URL),
        fetchText(GEMOJI_URL),
    ]);

    const emoji = parseEmojiTest(emojiTest);
    const annotations = parseCldrAnnotations(cldrAnnotations);
    const aliases = parseGemojiAliases(gemoji);

    for (const entry of emoji)
        mergeKeywords(entry, annotations.get(entry.emoji), aliases.get(entry.emoji));

    const generatedAt = new Date().toISOString().slice(0, 10);
    const output = [
        `// Generated from ${EMOJI_TEST_URL} plus CLDR English annotations and gemoji aliases.`,
        `// Generated on ${generatedAt}. Do not edit by hand; run "make emoji-data".`,
        `export const EMOJI_DATA = ${JSON.stringify(emoji, null, 4)};`,
        '',
    ].join('\n');

    fs.writeFileSync(OUTPUT, output);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
