let running = false;

async function run() {
	if (running) {
		return;
	}
	running = true;
	messenger.browserAction.disable();
	try {
		let filtered = await messenger.AutoTagger.runFilters();
		console.log(`AutoTagger: filters run on ${filtered} message(s).`);
	} catch (e) {
		console.error("AutoTagger: filter run failed:", e);
	} finally {
		messenger.browserAction.enable();
		running = false;
	}
}

messenger.AutoTagger.start();
messenger.browserAction.onClicked.addListener(run);
messenger.commands.onCommand.addListener(command => {
	if (command === "run-filters") {
		run();
	}
});
