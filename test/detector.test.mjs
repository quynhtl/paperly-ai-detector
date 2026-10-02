// The parts of src/bootstrap.js that do not need Paperly: reading the actor's
// answer, putting failures into words, and the request it sends. The file is
// run as Paperly runs it, as a script in a scope of its own, with a stand-in
// for the Zotero object.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../src/bootstrap.js", import.meta.url), "utf8");

class TimeoutException extends Error {}

// Arrays made in the script's own scope have that scope's prototypes
const plain = (value) => JSON.parse(JSON.stringify(value));

function load({ request } = {}) {
	const prefs = new Map();
	const scope = {
		ADDON_UNINSTALL: 6,
		Zotero: {
			HTTP: { request, TimeoutException },
			Prefs: {
				get: (name) => prefs.get(name),
				set: (name, value) => prefs.set(name, value),
				clear: (name) => prefs.delete(name),
			},
		},
	};
	vm.createContext(scope);
	vm.runInContext(SOURCE, scope);
	return scope;
}

// The example on the actor's page, verbatim
const EXAMPLE = [{
	success: true,
	data: {
		message: "OK",
		traceID: "e30e12d4a9f876bc19c9db8f7fef48a1",
		code: "COM_OK",
		data: {
			timedOut: false,
			value: {
				chunks: [{
					text: "LTK is the undisputed heavyweight giant of creator monetization.",
					startSpan: 0,
					endSpan: 62,
					type: "HUMAN",
					aiScore: 0,
					confidence: "high",
				}],
				aiScore: 0,
				humanParaphrasedScore: 0,
				aiParaphrasedScore: 0,
				modelVersion: "v7.1.0",
			},
		},
		status: 200,
	},
}];

function answer(chunks) {
	return [{ success: true, data: { status: 200, data: { timedOut: false, value: { chunks, modelVersion: "v7.1.0" } } } }];
}

test("reads the actor's own example", () => {
	const { readResult } = load();
	const verdict = readResult(EXAMPLE);
	assert.equal(verdict.aiPercent, 0);
	assert.equal(verdict.model, "v7.1.0");
	assert.deepEqual(plain(verdict.shares.map((s) => [s.type, s.percent])), [["HUMAN", 100]]);
	assert.equal(verdict.chunks[0].confidence, "high");
});

test("counts AI-written and AI-paraphrased text as AI, by characters", () => {
	const { readResult } = load();
	const verdict = readResult(answer([
		{ text: "a".repeat(50), type: "AI" },
		{ text: "b".repeat(20), type: "AI_PARAPHRASED" },
		{ text: "c".repeat(30), type: "HUMAN" },
	]));
	assert.equal(verdict.aiPercent, 70);
	assert.deepEqual(plain(verdict.shares.map((s) => [s.type, s.percent])), [["AI", 50], ["AI_PARAPHRASED", 20], ["HUMAN", 30]]);
});

test("makes percentages that add up to 100", () => {
	const { readResult } = load();
	const verdict = readResult(answer([
		{ text: "x".repeat(10), type: "AI" },
		{ text: "y".repeat(10), type: "HUMAN" },
		{ text: "z".repeat(10), type: "HUMAN_PARAPHRASED" },
	]));
	assert.equal(verdict.shares.reduce((sum, s) => sum + s.percent, 0), 100);
	assert.deepEqual(plain(verdict.shares.map((s) => s.percent).sort()), [33, 33, 34]);
});

test("names a kind it does not know, and does not count it as AI", () => {
	const { readResult } = load();
	const verdict = readResult(answer([
		{ text: "x".repeat(10), type: "MIXED_SIGNALS" },
		{ text: "y".repeat(10), type: "AI" },
	]));
	assert.equal(verdict.aiPercent, 50);
	assert.equal(verdict.shares.find((s) => s.type == "MIXED_SIGNALS").label, "Mixed signals");
});

test("refuses an answer that says the check failed", () => {
	const { readResult } = load();
	assert.throws(() => readResult([{ success: false, error: "Text too short" }]), /Text too short/);
	assert.throws(() => readResult([{ success: true, data: { status: 500, message: "Internal error" } }]), /Internal error/);
	assert.throws(() => readResult([]), /without an answer/);
	assert.throws(() => readResult(answer([])), /no verdict/);
	assert.throws(
		() => readResult([{ success: true, data: { status: 200, data: { timedOut: true } } }]),
		/ran out of time/,
	);
});

test("puts Apify's refusals into words", () => {
	const { describeFailure } = load();
	const failure = (status, message) => ({ status, xmlhttp: { status, response: message ? { error: { message } } : null } });
	assert.match(describeFailure(failure(401, "User was not found or authentication token is not valid")), /didn’t accept the token/);
	assert.match(describeFailure(failure(402, "Monthly usage hard limit exceeded")), /out of credit.*Monthly usage hard limit exceeded/);
	assert.match(describeFailure(failure(408)), /longer than two minutes/);
	assert.match(describeFailure(failure(500, "Boom")), /\(500\).*Boom/);
	assert.match(describeFailure(new TimeoutException()), /didn’t answer in time/);
	assert.match(describeFailure(failure(0)), /Couldn’t reach Apify/);
});

test("sends the passage to the actor with the token, and keeps it out of the log", async () => {
	let sent;
	const { detect } = load({
		request: async (method, url, options) => {
			sent = { method, url, options };
			return { status: 201, response: EXAMPLE };
		},
	});
	const verdict = await detect("A passage to check.", "apify_api_test");
	assert.equal(verdict.aiPercent, 0);
	assert.equal(sent.method, "POST");
	assert.equal(
		sent.url,
		"https://api.apify.com/v2/acts/dev00~quillbot-ai-detector-apify/run-sync-get-dataset-items?timeout=120",
	);
	assert.equal(sent.options.headers.Authorization, "Bearer apify_api_test");
	assert.deepEqual(JSON.parse(sent.options.body), { text: "A passage to check." });
	assert.equal(sent.options.logBodyLength, 0);
	assert.equal(sent.options.errorDelayMax, 0);
	assert.equal(sent.options.anon, true);
});

test("turns a failed request into a message", async () => {
	const { detect } = load({
		request: async () => {
			throw { status: 401, xmlhttp: { status: 401, response: { error: { message: "nope" } } } };
		},
	});
	await assert.rejects(detect("text", "bad"), /didn’t accept the token/);
});

test("counts words", () => {
	const { countWords } = load();
	assert.equal(countWords("  one two\nthree  "), 3);
	assert.equal(countWords(""), 0);
});
