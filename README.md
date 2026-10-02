# AI Detector for Paperly

A [Paperly](https://github.com/quynhtl/paperly-extensions) extension that checks
how much of a passage reads as AI-written: select text in a PDF and choose
**Check for AI**, or paste a passage into **Tools → Extensions… → AI Detector**.
It shows the share of the passage that reads as AI-written, AI-paraphrased and
human-written, and marks each sentence.

The check is run by
[QuillBot AI Detector & ChatGPT Content Checker](https://apify.com/dev00/quillbot-ai-detector-apify),
a community actor on Apify. **Neither the actor nor this extension is made by or
affiliated with QuillBot.** The actor's answers have the shape of QuillBot's own
detector's, so it most likely passes the text on to QuillBot; it may stop
working whenever QuillBot changes its site.

Detectors make mistakes, most of all on short, formulaic or translated text.
Treat a result as a hint, not proof.

## Setting it up

1. Make an [Apify](https://apify.com) account. The free plan needs no card and
   includes $5 of usage a month; the actor charges $5 per 1,000 checks (prices
   when this was written; see the actor's page).
2. Copy your API token from
   [Apify Console → Settings → API & Integrations](https://console.apify.com/settings/integrations).
3. In Paperly, open **Tools → Extensions…**, choose **AI Detector** in the bar
   on the left, paste the token and press **Save**.

## Using it

- In a PDF, select a passage and choose **Check for AI** in the popup. The
  first time, the passage is only filled in and you press **Check** yourself;
  after that the popup checks straight away.
- Or paste any text into the AI Detector view and press **Check**. **Use the
  reader's selection** takes what is selected in the open PDF.

A few sentences or more give the most reliable result.

## Privacy

- **What is sent:** only the passage you check, and only when you press
  **Check** (or **Check for AI**, once you have pressed Check yourself before).
  Nothing else from your library is read or sent.
- **Where it goes:** to Apify (`api.apify.com`), with your API token. Apify runs
  the community actor `dev00/quillbot-ai-detector-apify`, whose author controls
  what it does with the text; it most likely sends it to QuillBot to be checked.
- **How long it is kept:** Apify keeps each run's input and result in your Apify
  account for the retention period of your plan; you can delete runs in Apify
  Console. The actor's author and QuillBot have their own policies. This
  extension keeps nothing on any server.
- **On this computer:** the extension stores your Apify token in Paperly's
  preferences, and whether you have run a check before. Both are removed when
  you uninstall it. The passage is kept out of Paperly's debug log.
- No analytics, no telemetry.

## Building

Node 20 or later; nothing to install.

```sh
npm test                 # the parts that need no Paperly
npm run build            # dist/ai-detector@quynhtl.github.io-<version>.xpi
./scripts/icons.sh       # src/icon-*.png from assets/icon.svg
```

`test/preview.html` shows the view in a browser with a stand-in for Paperly:
`?mode=mock&token=x&run=1` for a made-up result, `&theme=dark` for the dark
theme, `?mode=live&token=<your token>&run=1` to call Apify for real.

To try a build, in Paperly: **Tools → Plugins**, the gear menu, **Install
Plugin From File…**, and pick the `.xpi`.

## Publishing a new version

1. Raise `version` in `src/manifest.json` and `package.json`, and build.
2. Create a GitHub release whose tag is the version (`v1.0.1`), with the
   `.xpi` attached. The marketplace picks it up; no pull request needed.

The listing itself is `marketplace/ai-detector@quynhtl.github.io.json`, a copy
of what goes into
[paperly-extensions](https://github.com/quynhtl/paperly-extensions)'s
`extensions/` folder.

## Licence

MIT. See [LICENSE](LICENSE).
