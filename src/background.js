let running = false;

async function run() {
	if (running) {
		return;
	}
	running = true;
	messenger.browserAction.disable();
	try {
		let tagged = await messenger.LocalInboxFilters.run();
		console.log(`Auto-tag: ${tagged} message(s) received thread tags.`);
	} catch (e) {
		console.error("Auto-tag failed:", e);
	} finally {
		messenger.browserAction.enable();
		running = false;
	}
}

messenger.browserAction.onClicked.addListener(run);
messenger.commands.onCommand.addListener(command => {
	if (command === "run-local-inbox-filters") {
		run();
	}
});
