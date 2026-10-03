/* global Zotero, ADDON_UNINSTALL */
// AI Detector: how much of a passage reads as AI-written.
//
// The check is run by "QuillBot AI Detector & ChatGPT Content Checker", a
// community actor on Apify (https://apify.com/dev00/quillbot-ai-detector-apify).
// Neither the actor nor this extension is QuillBot's own. The text checked goes
// to Apify, which runs the actor; the actor's answers have the shape of
// QuillBot's own detector's, so it most likely passes the text on to QuillBot.
// Apify charges the account whose token is used: $5 per 1,000 checks when this
// was written.
//
// Two ways in: a view in Paperly's Extensions window, and a "Check for AI"
// button in the reader's text-selection popup that opens the view on the
// selected text.

var ACTOR = "dev00/quillbot-ai-detector-apify";
var ENDPOINT = "https://api.apify.com/v2/acts/dev00~quillbot-ai-detector-apify/run-sync-get-dataset-items";
var ACTOR_URL = "https://apify.com/dev00/quillbot-ai-detector-apify";
var TOKEN_URL = "https://console.apify.com/settings/integrations";
var PREF_TOKEN = "extensions.ai-detector.apifyToken";
// Set once the user has pressed Check themselves: until then, the popup's
// button only fills the view in, so the first passage never leaves without
// the user having read where it goes
var PREF_SENT_BEFORE = "extensions.ai-detector.sentBefore";
var VIEW_ID = "check";
// How long the actor may run, in seconds. Apify itself stops waiting at 300.
var RUN_TIMEOUT = 120;
// Under this, a detector is guessing
var FEW_WORDS = 40;
var HTML_NS = "http://www.w3.org/1999/xhtml";

/** How each kind of passage the detector names is shown. */
var KINDS = {
	AI: { label: "AI-written", className: "ai", ai: true },
	AI_PARAPHRASED: { label: "AI-paraphrased", className: "ai-paraphrased", ai: true },
	HUMAN_PARAPHRASED: { label: "Human, paraphrased", className: "human-paraphrased", ai: false },
	HUMAN: { label: "Human-written", className: "human", ai: false },
};

var pluginID = null;
var iconURL = null;
var removeView = null;
// The view in each open Extensions window
var views = new Set();
// A passage the popup sent before the view was drawn
var pending = null;

function install() {}

function uninstall(data, reason) {
	// The token goes with the extension, but stays through an update
	if (reason === ADDON_UNINSTALL) {
		Zotero.Prefs.clear(PREF_TOKEN, true);
		Zotero.Prefs.clear(PREF_SENT_BEFORE, true);
	}
}

function startup({ id, rootURI }) {
	pluginID = id;
	iconURL = rootURI + "icon-96.png";
	// The Extensions window is Paperly's: plain Zotero has nowhere to show this
	if (!Zotero.PaperlyExtensions) {
		return;
	}
	removeView = Zotero.PaperlyExtensions.registerView({
		pluginID: id,
		id: VIEW_ID,
		label: "AI Detector",
		icon: iconURL,
		onRender({ body }) {
			views.add(createView(body));
		},
		onDestroy({ body }) {
			for (let view of views) {
				if (view.body === body) {
					views.delete(view);
				}
			}
		},
	});
	Zotero.Reader.registerEventListener("renderTextSelectionPopup", onSelectionPopup, id);
}

function shutdown() {
	Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", onSelectionPopup);
	if (removeView) {
		removeView();
		removeView = null;
	}
	views.clear();
	pending = null;
}

// ------------------------------------------------------------------ reader --

function onSelectionPopup({ doc, params, append }) {
	let text = (params.annotation && params.annotation.text || "").trim();
	if (!text) {
		return;
	}
	let button = doc.createElement("button");
	// The popup's own look, as its Add to Note button has
	button.className = "toolbar-button wide-button";
	button.textContent = "Check for AI";
	button.title = "Check this passage with AI Detector";
	button.addEventListener("click", () => checkFromReader(text));
	append(button);
}

function checkFromReader(text) {
	if (views.size) {
		for (let view of views) {
			view.take(text);
		}
	}
	else {
		// The view draws itself when the window shows it, and picks this up
		pending = text;
	}
	Zotero.PaperlyExtensions.openWindow({ view: `${pluginID}:${VIEW_ID}` });
}

// ------------------------------------------------------------------- check --

function getToken() {
	return String(Zotero.Prefs.get(PREF_TOKEN, true) || "").trim();
}

function countWords(text) {
	let words = text.trim().match(/\S+/g);
	return words ? words.length : 0;
}

/**
 * Sends `text` to the actor and resolves with what readResult() makes of the
 * answer, or rejects with an Error whose message can be shown as it is.
 */
async function detect(text, token) {
	let xmlhttp;
	try {
		xmlhttp = await Zotero.HTTP.request("POST", `${ENDPOINT}?timeout=${RUN_TIMEOUT}`, {
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ text }),
			responseType: "json",
			// Apify's own wait, and some room for the trip
			timeout: (RUN_TIMEOUT + 30) * 1000,
			// Every attempt is a check Apify charges for
			errorDelayMax: 0,
			noRetryOnThrottle: true,
			// Apify needs the token and nothing else of Paperly's
			anon: true,
			// The passage is the user's: it stays out of the debug log
			logBodyLength: 0,
		});
	}
	catch (e) {
		throw new Error(describeFailure(e));
	}
	return readResult(xmlhttp.response);
}

/** What went wrong in words, from a Zotero.HTTP rejection. */
function describeFailure(e) {
	let status = e && (e.status || (e.xmlhttp && e.xmlhttp.status)) || 0;
	let response = e && e.xmlhttp && e.xmlhttp.response;
	let said = response && response.error && response.error.message;
	let because = said ? ` Apify says: “${said}”` : "";
	switch (status) {
		case 401:
			return "Apify didn’t accept the token. Copy it again from Apify Console → Settings → API & Integrations.";
		case 402:
			return `Apify wants payment for this check: the account may be out of credit.${because}`;
		case 403:
			return `The token isn’t allowed to run the actor.${because}`;
		case 404:
			return `Apify has no actor called ${ACTOR} any more.`;
		case 408:
			return "The check took longer than two minutes. Try a shorter passage.";
		case 429:
			return "Apify is turning requests away for now. Wait a minute and try again.";
	}
	if (Zotero.HTTP.TimeoutException && e instanceof Zotero.HTTP.TimeoutException) {
		return "Apify didn’t answer in time. Try again, or try a shorter passage.";
	}
	if (!status) {
		return "Couldn’t reach Apify. Check the internet connection.";
	}
	return `Apify answered with an error (${status}).${because}`;
}

/**
 * The actor's dataset item, made into what the view shows: the passage in
 * pieces, each with its kind, and the share of the passage each kind has.
 *
 * The share is counted in characters rather than taken from the actor's
 * scores, whose scale it does not document; it is also what QuillBot's own
 * page reports ("x% of text is likely AI").
 */
function readResult(items) {
	let item = Array.isArray(items) ? items[0] : items;
	if (!item || typeof item != "object") {
		throw new Error("The actor finished without an answer. Try again.");
	}
	if (item.success === false) {
		let said = (item.data && item.data.message) || item.error || item.message;
		throw new Error(`The detector couldn’t check this passage${said ? `: ${said}` : "."}`);
	}
	// The actor answers with the verdict itself ({ success, text, aiScore,
	// chunks }); its page shows it wrapped in the detector's own reply
	// ({ data: { status, data: { timedOut, value } } }), so both are read
	let value = item;
	if (!Array.isArray(item.chunks) && item.data) {
		let reply = item.data;
		if (reply.status && reply.status != 200) {
			throw new Error(`The detector couldn’t check this passage${reply.message ? `: ${reply.message}` : "."}`);
		}
		let outcome = reply.data || {};
		if (outcome.timedOut) {
			throw new Error("The detector ran out of time. Try again, or try a shorter passage.");
		}
		value = outcome.value || {};
	}
	if (item.timedOut) {
		throw new Error("The detector ran out of time. Try again, or try a shorter passage.");
	}
	let chunks = (Array.isArray(value.chunks) ? value.chunks : [])
		.filter(chunk => chunk && typeof chunk.text == "string" && chunk.text.trim() && !chunk.isFailed);
	if (!chunks.length) {
		throw new Error("The detector gave no verdict for this passage.");
	}

	let lengths = new Map();
	let total = 0;
	for (let chunk of chunks) {
		let type = String(chunk.type || "HUMAN");
		lengths.set(type, (lengths.get(type) || 0) + chunk.text.length);
		total += chunk.text.length;
	}
	let shares = toPercents([...lengths].map(([type, length]) => ({ type, ...kindOf(type), length })), total)
		.sort((a, b) => order(a.type) - order(b.type));
	return {
		chunks: chunks.map(chunk => ({
			text: chunk.text,
			type: String(chunk.type || "HUMAN"),
			confidence: typeof chunk.confidence == "string" ? chunk.confidence : null,
		})),
		shares,
		aiPercent: shares.filter(share => share.ai).reduce((sum, share) => sum + share.percent, 0),
		model: typeof value.modelVersion == "string" ? value.modelVersion : null,
	};
}

function kindOf(type) {
	return KINDS[type] || {
		label: type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " "),
		className: "other",
		ai: false,
	};
}

function order(type) {
	let index = Object.keys(KINDS).indexOf(type);
	return index == -1 ? Object.keys(KINDS).length : index;
}

/** Whole percentages that add up to 100: the largest remainders get the spare points. */
function toPercents(parts, total) {
	let exact = parts.map(part => ({ ...part, exact: total ? (part.length / total) * 100 : 0 }));
	let result = exact.map(part => ({ ...part, percent: Math.floor(part.exact) }));
	let spare = (total ? 100 : 0) - result.reduce((sum, part) => sum + part.percent, 0);
	[...result]
		.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))
		.slice(0, spare)
		.forEach(part => part.percent++);
	return result.map(({ exact: _exact, length: _length, ...part }) => part);
}

// -------------------------------------------------------------------- view --

var STYLE = `
.aid {
	display: flex;
	flex-direction: column;
	gap: 12px;
	max-width: 720px;
}
.aid p {
	margin: 0;
}
.aid-intro, .aid-note, .aid-count {
	color: var(--fill-secondary);
}
.aid-row {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}
.aid-spacer {
	flex: 1;
}
.aid input, .aid textarea {
	box-sizing: border-box;
	padding: 6px 8px;
	border: 1px solid var(--color-border);
	border-radius: 5px;
	background: var(--material-background);
	color: var(--fill-primary);
	font: inherit;
}
.aid input {
	flex: 1;
	min-width: 180px;
}
.aid textarea {
	width: 100%;
	min-height: 140px;
	resize: vertical;
	line-height: 1.45;
}
.aid input:focus-visible, .aid textarea:focus-visible {
	outline: 2px solid var(--accent-blue50);
	outline-offset: -1px;
}
.aid-status:empty {
	display: none;
}
.aid-status.is-error {
	color: var(--accent-red, #d12d2d);
}
.aid-result {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding-top: 12px;
	border-top: 1px solid var(--color-border50);
}
.aid-result[hidden] {
	display: none;
}
.aid-score {
	font-size: 15px;
}
.aid-score strong {
	font-size: 22px;
	margin-inline-end: 4px;
}
.aid-bar {
	display: flex;
	height: 8px;
	border-radius: 4px;
	overflow: hidden;
	background: var(--fill-quinary);
}
.aid-legend {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 14px;
	margin: 0;
	padding: 0;
	list-style: none;
}
.aid-legend li::before {
	content: "";
	display: inline-block;
	width: 9px;
	height: 9px;
	margin-inline-end: 6px;
	border-radius: 2px;
	background: var(--aid-swatch);
}
.aid-passage {
	line-height: 1.6;
	white-space: pre-wrap;
}
.aid-passage span {
	border-radius: 3px;
}
.aid .ai { --aid-swatch: rgb(255, 149, 0); }
.aid .ai-paraphrased { --aid-swatch: rgb(175, 82, 222); }
.aid .human-paraphrased { --aid-swatch: rgb(52, 170, 220); }
.aid .human { --aid-swatch: rgb(52, 199, 89); }
.aid .other { --aid-swatch: rgb(142, 142, 147); }
.aid-bar span {
	background: var(--aid-swatch);
}
.aid-passage .ai { background: rgba(255, 149, 0, 0.28); }
.aid-passage .ai-paraphrased { background: rgba(175, 82, 222, 0.26); }
.aid-passage .human-paraphrased { background: rgba(52, 170, 220, 0.2); }
`;

/**
 * Draws the view into `body` and returns a handle: { body, take(text) },
 * take() being how the selection popup hands it a passage.
 */
function createView(body) {
	let doc = body.ownerDocument;
	let el = (tag, props = {}, ...children) => {
		let node = doc.createElementNS(HTML_NS, tag);
		for (let [key, value] of Object.entries(props)) {
			if (key == "class") {
				node.className = value;
			}
			else if (key == "text") {
				node.textContent = value;
			}
			else if (key.startsWith("on")) {
				node.addEventListener(key.slice(2), value);
			}
			else {
				node.setAttribute(key, value);
			}
		}
		node.append(...children);
		return node;
	};
	let link = (text, url) => el("button", { class: "link", text, onclick: () => Zotero.launchURL(url) });

	let intro = el("p", { class: "aid-intro" },
		"Checks how much of a passage reads as AI-written. The check is run by ",
		link("QuillBot AI Detector", ACTOR_URL),
		", a community actor on Apify that is not QuillBot’s own. The passage is sent to Apify, "
			+ "and each check uses about $0.005 of your Apify credit.");

	// The token: asked for until there is one, then only mentioned
	let tokenRow = el("div", { class: "aid-row" });
	let tokenInput = el("input", {
		type: "password",
		placeholder: "Apify API token",
		"aria-label": "Apify API token",
		autocomplete: "off",
		spellcheck: "false",
	});
	let saveToken = () => {
		let value = tokenInput.value.trim();
		if (!value) {
			tokenInput.focus();
			return;
		}
		Zotero.Prefs.set(PREF_TOKEN, value, true);
		tokenInput.value = "";
		drawToken();
		textarea.focus();
	};
	tokenInput.addEventListener("keydown", (event) => {
		if (event.key == "Enter") {
			saveToken();
		}
	});
	function drawToken() {
		if (getToken()) {
			tokenRow.replaceChildren(
				el("span", { class: "aid-count", text: "Apify token saved on this computer." }),
				el("span", { class: "aid-spacer" }),
				el("button", {
					text: "Change",
					onclick: () => {
						// The saved token stays in use until another is saved
						tokenRow.replaceChildren(
							tokenInput,
							el("button", { text: "Save", onclick: saveToken }),
							el("button", {
								text: "Cancel",
								onclick: () => {
									tokenInput.value = "";
									drawToken();
								},
							}),
						);
						tokenInput.focus();
					},
				}),
				el("button", {
					text: "Remove",
					onclick: () => {
						Zotero.Prefs.clear(PREF_TOKEN, true);
						drawToken();
					},
				}),
			);
		}
		else {
			tokenRow.replaceChildren(
				tokenInput,
				el("button", { text: "Save", onclick: saveToken }),
				link("Get a token", TOKEN_URL),
			);
		}
	}

	let textarea = el("textarea", {
		rows: "8",
		"aria-label": "Passage to check",
		placeholder: "Paste a passage, or select text in a PDF and choose Check for AI.",
	});
	let count = el("span", { class: "aid-count", text: "0 words" });
	let showCount = () => {
		let words = countWords(textarea.value);
		count.textContent = words == 1 ? "1 word" : `${words} words`;
	};
	textarea.addEventListener("input", showCount);
	let useSelection = el("button", {
		text: "Use the reader’s selection",
		onclick: () => {
			let { reader } = Zotero.PaperlyExtensions.getContext();
			if (reader && reader.selectedText) {
				textarea.value = reader.selectedText;
				showCount();
				say("");
			}
			else {
				say("Nothing is selected in an open PDF.");
			}
		},
	});
	let checkButton = el("button", { class: "primary", text: "Check", onclick: () => check() });
	let status = el("p", { class: "aid-status", role: "status", "aria-live": "polite" });
	let result = el("div", { class: "aid-result", hidden: "true" });

	function say(message, isError = false) {
		status.textContent = message;
		status.classList.toggle("is-error", isError);
	}

	let busy = false;
	async function check() {
		if (busy) {
			return;
		}
		let text = textarea.value.trim();
		if (!text) {
			say("Paste a passage first, or select one in a PDF.");
			textarea.focus();
			return;
		}
		let token = getToken();
		if (!token) {
			say("Add your Apify token first.");
			tokenInput.focus();
			return;
		}
		busy = true;
		checkButton.disabled = true;
		result.hidden = true;
		say(countWords(text) < FEW_WORDS
			? "Checking… With this few words the result is only a rough guess."
			: "Checking… This can take up to a minute.");
		try {
			let verdict = await detect(text, token);
			Zotero.Prefs.set(PREF_SENT_BEFORE, true, true);
			if (body.isConnected) {
				drawResult(verdict);
				say("");
			}
		}
		catch (e) {
			say(e.message, true);
		}
		finally {
			busy = false;
			checkButton.disabled = false;
		}
	}

	function drawResult(verdict) {
		let bar = el("div", { class: "aid-bar", role: "presentation" });
		let legend = el("ul", { class: "aid-legend" });
		for (let share of verdict.shares) {
			if (share.percent) {
				bar.append(el("span", { class: share.className, style: `width: ${share.percent}%` }));
			}
			legend.append(el("li", { class: share.className, text: `${share.label} ${share.percent}%` }));
		}
		let passage = el("div", { class: "aid-passage" });
		verdict.chunks.forEach((chunk, index) => {
			let kind = kindOf(chunk.type);
			if (index) {
				passage.append(" ");
			}
			passage.append(el("span", {
				class: kind.className,
				title: chunk.confidence ? `${kind.label}, ${chunk.confidence} confidence` : kind.label,
				text: chunk.text,
			}));
		});
		result.replaceChildren(
			el("p", { class: "aid-score" },
				el("strong", { text: `${verdict.aiPercent}%` }),
				"of this passage reads as AI-written or AI-paraphrased"),
			bar,
			legend,
			passage,
			el("p", {
				class: "aid-note",
				text: "Detectors make mistakes, most of all on short, formulaic or translated text: "
					+ "treat this as a hint, not proof."
					+ (verdict.model ? ` Detector model ${verdict.model}.` : ""),
			}),
		);
		result.hidden = false;
	}

	if (!doc.getElementById("aid-style")) {
		(doc.head || doc.documentElement).append(el("style", { id: "aid-style", text: STYLE }));
	}
	body.append(el("div", { class: "aid" },
		intro,
		tokenRow,
		textarea,
		el("div", { class: "aid-row" }, useSelection, count, el("span", { class: "aid-spacer" }), checkButton),
		status,
		result,
	));
	drawToken();

	let view = {
		body,
		take(text) {
			textarea.value = text;
			showCount();
			result.hidden = true;
			// Straight to the check once the user has done one themselves
			if (getToken() && Zotero.Prefs.get(PREF_SENT_BEFORE, true)) {
				check();
			}
			else {
				say(getToken() ? "Press Check to send this passage to Apify." : "Add your Apify token, then press Check.");
				(getToken() ? checkButton : tokenInput).focus();
			}
		},
	};
	if (pending) {
		let text = pending;
		pending = null;
		view.take(text);
	}
	return view;
}
